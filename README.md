# VoidFile
**Upload files completely anonymously, no registration required.**

Unfortunately, because we do not have a server to properly host VoidFile, the VoidFile link specified in `index.html` is not accessible. It only exposes the API used to render images through a proxy for privacy purposes.

# ⚙️ Installations
## Github
```
git clone https://github.com/firstdecree/voidfile
```

## NpmJS
```
npm install
```

## PNPM
```
pnpm install
```

# 🛠️ Setup
Please refer to `config.toml.example`; all required configuration settings are there. VoidFile uses MongoDB GridFS to store files, with a maximum file size limit of 2 GB.

# 🚀 Usage
```
node index.js
```

# 🔐 Security
Uploaded files are encrypted using AES-256-GCM with a SHA-256 hash. All of its properties, including the file name and metadata, are also encrypted.

The only unencrypted fields are the upload date, expiration date, file length, and chunk size.

# 🌟 Backers & Sponsors
<table border="1">
    <tr>
        <td style="text-align: center; padding: 10px;">
            <img src="https://i.ibb.co/W46hXD5f/download.png" alt="Vexhub Hosting" style="width: 150px; height: auto; border-radius:50%; object-fit:cover;">
            <br>
            <p align="center"><a href="https://vexhub.dev/">Vexhub Hosting</a></p>
        </td>
        <td style="text-align: center; padding: 10px;">
            <img src="https://i.ibb.co/1fvHmWM3/apple-touch-icon-256x256.png" alt="Vercel" style="width: 150px; height: auto; border-radius:50%; object-fit:cover;">
            <br>
            <p align="center"><a href="https://vercel.com/">Vercel</a></p>
        </td>
    </tr>
</table>

<div align="center">
  <sub>This project is distributed under <a href="/LICENSE"><b>MIT License</b></a></sub>
</div>