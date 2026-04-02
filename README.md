# 3DS eShop Clone

A web-based Nintendo 3DS eShop clone with file management, QR code generation, and homebrew support.

## Description

This project recreates the Nintendo 3DS eShop experience in a web browser. It allows users to browse games, DLC, apps, Virtual Console titles, and homebrew applications. Files can be uploaded and downloaded with automatic QR code generation for easy installation via FBI on a modded 3DS console.

## Features

### Content Sections
- **Games** - Browse 3DS game library with region filtering (USA/EUR/JPN)
- **DLC** - Downloadable content for games
- **Apps** - System applications
- **Virtual Console** - Classic games (NES, SNES, Game Boy, GBC, GBA, N64, Genesis)
- **Homebrew** - Community applications (emulators, utilities, themes, tools)
- **FBI Seeds** - Seed database for CIA installation

### File Management
- Upload CIA, 3DSX, 3DS files (up to 5GB)
- Automatic SHA256 hash calculation
- Download count tracking
- File organization by category
- Uploaded by user tracking

### QR Code System
- Generate QR codes for any title
- Scan with FBI for remote installation
- Download QR code as image
- Copy direct download links

### Admin Panel
- Dashboard with statistics and charts
- File management (edit, delete)
- Activity logs with filtering
- Upload/download graphs (Chart.js)
- User leaderboard

### 3DS Hack Guide
- Getting started guide
- CFW installation instructions
- FBI usage tutorial
- FAQ section

### Additional Features
- Dark mode toggle
- Search functionality
- Region filtering
- Block size display
- Game icons from GitHub repository
- Responsive design (Bootstrap 5)
- SQLite database backend

## Installation

### Prerequisites
- Node.js 16+ ([download](https://nodejs.org/))
- npm (included with Node.js)

### Steps

1. Clone or download the repository:
```bash
git clone [https://github.com/your-username/3ds-eshop-clone.git](https://github.com/wildfirebill-nintendo-3ds/3ds-eshop-clone-sqlite.git)
cd 3ds-eshop-clone
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

4. Open in browser:
- **eShop:** http://localhost:4000
- **Admin Panel:** http://localhost:4000/admin.html

### Development Mode
For auto-restart on file changes:
```bash
npm run dev
```

## Default Admin Credentials
- **Username:** admin
- **Password:** admin123

Change these after first login via the admin panel.

## File Structure

```
3ds-eshop-clone/
├── server.js           # Express backend
├── db.js               # SQLite database module
├── index.html          # Main eShop frontend
├── admin.html          # Admin panel
├── package.json        # Dependencies
├── css/
│   └── styles.css      # Custom styles
├── js/
│   └── app.js          # Frontend logic
└── data/
    ├── eshop.db        # SQLite database
    ├── games/          # Game files
    ├── dlc/            # DLC files
    ├── apps/           # App files
    ├── virtual-console/# VC files
    ├── homebrew/       # Homebrew files
    │   ├── emulators/
    │   ├── utilities/
    │   ├── games/
    │   ├── themes/
    │   └── tools/
    └── seeds/          # Seed files
```

## API Endpoints

### Files
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files` | List files (paginated) |
| GET | `/api/files/:id` | Get file details |
| POST | `/api/files/upload` | Upload file |
| PUT | `/api/files/:id` | Update file metadata |
| DELETE | `/api/files/:id` | Delete file |
| GET | `/api/download/:id` | Download file |

### Seeds
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/seeds` | List seeds |
| GET | `/api/seeds/:titleId` | Get seed by title ID |
| GET | `/api/seeds/:titleId/download` | Download .dat file |
| POST | `/api/seeds/refresh` | Refresh from sources |
| POST | `/api/seeds/upload` | Upload seeddb.bin |

### Statistics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Get statistics |
| GET | `/api/stats/uploads` | Get upload chart data |

### Logs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/logs` | Get activity logs |
| DELETE | `/api/logs` | Clear logs |

## Using with FBI

1. Open FBI on your 3DS
2. Go to **Remote Install**
3. Select **Scan QR Code**
4. Point camera at the QR code from the eShop

### Installing Seeds
Seeds are required for some CIA files:
1. Go to the **Seeds** section
2. Find the title ID
3. Download the seed or scan QR code
4. Seeds are saved to `sd:/fbi/seed/`

## Technologies Used

- **Frontend:** HTML5, Bootstrap 5, Chart.js, QRCode.js
- **Backend:** Node.js, Express
- **Database:** SQLite (better-sqlite3)
- **File Upload:** Multer

## Credits

- Icons: [3DS Game Icons](https://github.com/wildfirebill-nintendo-3ds/3dsgamesicons)
- Seeds: [3DS-rom-tools](https://github.com/ihaveamac/3DS-rom-tools)
- Hack Guide: [3ds.hacks.guide](https://3ds.hacks.guide)

## License

MIT License
