(async () => {
    "use strict"

    // Dependencies
    const client = await require("./modules/mongodb.js")
    const { GridFSBucket } = require("mongodb")
    const compression = require("compression")
    const { parse } = require("smol-toml")
    const express = require("express")
    const multer = require("multer")
    const crypto = require("crypto")
    const helmet = require("helmet")
    const axios = require("axios")
    const path = require("path")
    const fs = require("fs")
    const os = require("os")

    // Variables
    const config = parse(fs.readFileSync("./config.toml", "utf8"))
    const port = process.env.PORT || 8080
    const web = express()
    const upload = multer({
        storage: multer.diskStorage({
            destination: os.tmpdir(),
            filename: (req, file, cb) => {
                cb(null, crypto.randomBytes(16).toString("hex"))
            }
        }),
        limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB limit
    })

    const database = client.db(config.database.databaseName)
    const bucket = new GridFSBucket(database, { bucketName: config.database.filesCollectionName })

    setInterval(async()=>{
        try {
            const filesColl = database.collection(config.database.filesCollectionName + ".files")
            const expiredFiles = await filesColl.find({ "metadata.expireAt": { $lt: new Date() } }).toArray()
            for (const file of expiredFiles) await bucket.delete(file._id).catch(()=>{ })
        }catch(err){
            console.log(`Error at GridFS files clean up: ${err.toSTring()}`)
        }
    }, 60 * 1000)

    // Configurations
    //* Express
    web.use(compression({ level: 1 }))
    web.use(helmet({ contentSecurityPolicy: false }))

    // Main
    web.use(express.static(path.join((__dirname, "public")), { extensions: ["html"] }))
    web.get("/api/render-image", async (req, res) => {
        // Variables
        const imageUrl = req.query.u

        // Validations
        if (!imageUrl) return res.json({
            status: "failed",
            message: "Invalid Image URL at query 'u'"
        })

        // Core
        try{
            const response = await axios.get(imageUrl, { responseType: "stream" })
            res.setHeader("Content-Type", response.headers["content-type"])
            response.data.pipe(res)
        } catch {
            res.json({
                status: "failed",
                message: "Failed to read the image."
            })
        }
    })

    web.post("/api/upload", upload.single("file"), async (req, res) => {
        try {
            // Top Validations
            if (!req.file) return res.json({
                status: "failed",
                message: "No file uploaded."
            })

            // Variables
            const { expiration, password } = req.body
            if(expiration.length > 3) expiration = 24 * 3600
            var expireSeconds = 24 * 3600 // 1d by default

            if (expiration === "1h") expireSeconds = 3600
            if (expiration === "6h") expireSeconds = 6 * 3600
            if (expiration === "12h") expireSeconds = 12 * 3600
            if (expiration === "3d") expireSeconds = 3 * 24 * 3600
            if (expiration === "7d") expireSeconds = 7 * 24 * 3600

            //Core
            const id = crypto.randomBytes(8).toString("hex")
            const passStr = password ? (id + password) : id
            const dbId = crypto.createHash("sha256").update(passStr).digest("hex")
            const key = crypto.createHash("sha256").update(passStr).digest()
            const iv = crypto.randomBytes(16)

            const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
            const expireAt = new Date(Date.now() + expireSeconds * 1000)

            const metaIv = crypto.randomBytes(16)
            const metaCipher = crypto.createCipheriv("aes-256-gcm", key, metaIv)
            const metaPayload = JSON.stringify({ name: req.file.originalname, mime: req.file.mimetype })
            const encMeta = Buffer.concat([metaCipher.update(metaPayload, "utf8"), metaCipher.final()])
            const metaAuthTag = metaCipher.getAuthTag()
            const uploadStream = bucket.openUploadStreamWithId(dbId, "encrypted_file", {
                metadata: {
                    encMeta: encMeta,
                    metaIv: metaIv,
                    metaAuthTag: metaAuthTag,
                    iv: iv,
                    expireAt: expireAt
                }
            })

            const readStream = fs.createReadStream(req.file.path)
            readStream.pipe(cipher).pipe(uploadStream)
            uploadStream.on("error", () => {
                fs.unlink(req.file.path, ()=>{})
                if (!res.headersSent) res.json({
                    status: "failed",
                    message: "Failed to upload file."
                })
            })

            uploadStream.on("finish", async () => {
                const authTag = cipher.getAuthTag()
                await database.collection(config.database.filesCollectionName + ".files").updateOne(
                    { _id: dbId },
                    { $set: { "metadata.authTag": authTag } }
                )
                fs.unlink(req.file.path, ()=>{})
                res.json({ id, expiration: expireAt })
            })
        }catch{
            if (req.file) fs.unlink(req.file.path, ()=>{})
            if (!res.headersSent) res.json({
                status: "failed",
                message: "Failed to upload file."
            })
        }
    })

    web.get("/f/:id", async (req, res) => {
        try {
            // Variables
            const fileID = req.params.id
            if(!fileID) return res.json({
                status: "failed",
                message: "File not found or expired."
            })
            const pwd = req.query.p || ""
            const filesColl = database.collection(config.database.filesCollectionName + ".files")

            const passStr = pwd ? (fileID + pwd) : fileID
            const key = crypto.createHash("sha256").update(passStr).digest()
            const dbId = crypto.createHash("sha256").update(passStr).digest("hex")

            // Validations
            const fileDoc = await filesColl.findOne({ _id: dbId })
            if (!fileDoc) return res.json({
                status: "failed",
                message: "File not found or expired."
            })

            const meta = fileDoc.metadata || {}
            if (!meta.iv || !meta.authTag || !meta.encMeta || !meta.metaIv || !meta.metaAuthTag) return res.json({
                status: "failed",
                message: "File data is incomplete."
            })

            // Core
            var decMeta;

            try{
                const metaDecipher = crypto.createDecipheriv("aes-256-gcm", key, meta.metaIv.buffer || meta.metaIv)
                metaDecipher.setAuthTag(meta.metaAuthTag.buffer || meta.metaAuthTag)
                const decMetaBuf = Buffer.concat([metaDecipher.update(meta.encMeta.buffer || meta.encMeta), metaDecipher.final()])
                decMeta = JSON.parse(decMetaBuf.toString("utf8"))
            }catch{
                return res.json({
                    status: "failed",
                    message: "Failed to decrypt secure metadata."
                })
            }

            const decipher = crypto.createDecipheriv("aes-256-gcm", key, meta.iv.buffer || meta.iv)
            decipher.setAuthTag(meta.authTag.buffer || meta.authTag)

            res.setHeader("Content-Disposition", `attachment; filename="${decMeta.name}"`)
            res.setHeader("Content-Type", decMeta.mime)

            const downloadStream = bucket.openDownloadStream(dbId)
            downloadStream.pipe(decipher).pipe(res)
            downloadStream.on("error", () => {
                if (!res.headersSent) res.json({
                    status: "failed",
                    message: "Error reading file."
                })
            })

            decipher.on("error", () => {
                if (!res.headersSent) return res.json({
                    status: "failed",
                    message: "Invalid password or corrupted file block."
                })
                res.end()
            })
        }catch{
            if (!res.headersSent) res.json({
                status: "failed",
                message: "Internal server error."
            })
        }
    })

    web.use("/{*any}", (req, res)=>res.redirect("/"))
    web.listen(port, () => { console.log(`Server is running. Port: ${port}`) })
})()