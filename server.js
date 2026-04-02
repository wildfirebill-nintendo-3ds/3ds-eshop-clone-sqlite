const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Request logging
app.use(morgan('combined'));

// ============================================
// Data Storage (JSON files - replace with DB in production)
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILES = {
    files: path.join(DATA_DIR, 'db', 'files.json'),
    logs: path.join(DATA_DIR, 'db', 'logs.json'),
    users: path.join(DATA_DIR, 'db', 'users.json'),
    stats: path.join(DATA_DIR, 'db', 'stats.json')
};

// Ensure directories exist
const UPLOAD_DIRS = {
    games: path.join(DATA_DIR, 'games'),
    dlc: path.join(DATA_DIR, 'dlc'),
    apps: path.join(DATA_DIR, 'apps'),
    'virtual-console': path.join(DATA_DIR, 'virtual-console'),
    homebrew: path.join(DATA_DIR, 'homebrew')
};

// Create directories
Object.values(UPLOAD_DIRS).forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const dbDir = path.join(DATA_DIR, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// ============================================
// Database Functions
// ============================================
function readDB(file) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify([], null, 2));
            return [];
        }
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${file}:`, error);
        return [];
    }
}

function writeDB(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${file}:`, error);
        return false;
    }
}

// ============================================
// Logging System
// ============================================
function addLog(action, details, user = 'system') {
    const logs = readDB(DB_FILES.logs);
    const logEntry = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        action,
        details,
        user,
        ip: details.ip || 'unknown'
    };
    logs.unshift(logEntry);
    
    // Keep only last 1000 logs
    if (logs.length > 1000) logs.length = 1000;
    
    writeDB(DB_FILES.logs, logs);
    console.log(`[${logEntry.timestamp}] ${action}: ${JSON.stringify(details)}`);
    return logEntry;
}

// ============================================
// File Upload Configuration
// ============================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const category = req.body.category || 'homebrew';
        let uploadPath = UPLOAD_DIRS[category] || UPLOAD_DIRS.homebrew;
        
        // Add subfolder for homebrew
        if (category === 'homebrew' && req.body.homebrewCategory) {
            uploadPath = path.join(uploadPath, req.body.homebrewCategory);
        }
        
        // Add subfolder for virtual console
        if (category === 'virtual-console' && req.body.vcSystem) {
            uploadPath = path.join(uploadPath, req.body.vcSystem);
        }
        
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, safeName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.cia', '.3dsx', '.3ds', '.zip'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext) || file.mimetype.includes('zip')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Allowed: CIA, 3DSX, 3DS, ZIP'));
        }
    }
});

// ============================================
// API Routes
// ============================================

// Get all files
app.get('/api/files', (req, res) => {
    const files = readDB(DB_FILES.files);
    const { category, search, page = 1, limit = 50 } = req.query;
    
    let filtered = files;
    
    if (category && category !== 'all') {
        filtered = filtered.filter(f => f.category === category);
    }
    
    if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(f => 
            f.name.toLowerCase().includes(searchLower) ||
            f.titleId?.toLowerCase().includes(searchLower)
        );
    }
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginated = filtered.slice(startIndex, endIndex);
    
    res.json({
        success: true,
        data: paginated,
        pagination: {
            total: filtered.length,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(filtered.length / limit)
        }
    });
});

// Get single file
app.get('/api/files/:id', (req, res) => {
    const files = readDB(DB_FILES.files);
    const file = files.find(f => f.id === req.params.id);
    
    if (!file) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    res.json({ success: true, data: file });
});

// Upload file
app.post('/api/files/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        
        const files = readDB(DB_FILES.files);
        const category = req.body.category || 'homebrew';
        
        // Build relative path
        let relativePath = path.relative(__dirname, req.file.path).replace(/\\/g, '/');
        
        // Calculate SHA256 hash
        const sha256 = await calculateFileHash(req.file.path);
        
        const newFile = {
            id: uuidv4(),
            name: req.body.name || path.parse(req.file.originalname).name,
            titleId: req.body.titleId || generateTitleId(),
            productCode: req.body.productCode || null,
            category: category,
            homebrewCategory: req.body.homebrewCategory || null,
            vcSystem: req.body.vcSystem || null,
            region: req.body.region || 'region-global',
            description: req.body.description || '',
            size: req.file.size,
            fileName: req.file.originalname,
            filePath: relativePath,
            fileType: req.file.mimetype,
            sha256: sha256,
            uploadedBy: req.body.uploadedBy || 'Anonymous',
            downloadCount: 0,
            uploadDate: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            icon: req.body.icon || null
        };
        
        files.push(newFile);
        writeDB(DB_FILES.files, files);
        
        // Log the upload
        addLog('FILE_UPLOAD', {
            fileId: newFile.id,
            fileName: newFile.name,
            category: newFile.category,
            size: newFile.size,
            sha256: sha256,
            uploadedBy: newFile.uploadedBy,
            ip: req.ip
        }, newFile.uploadedBy);
        
        // Update stats
        updateStats('upload', category);
        
        res.json({ success: true, data: newFile });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update file metadata (admin only - for now no auth check)
app.put('/api/files/:id', (req, res) => {
    const files = readDB(DB_FILES.files);
    const index = files.findIndex(f => f.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    const allowedFields = ['name', 'titleId', 'productCode', 'description', 'region', 'category', 
                          'homebrewCategory', 'vcSystem', 'uploadedBy', 'icon'];
    
    const updates = {};
    allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
            updates[field] = req.body[field];
        }
    });
    
    files[index] = {
        ...files[index],
        ...updates,
        lastModified: new Date().toISOString()
    };
    
    writeDB(DB_FILES.files, files);
    
    addLog('FILE_UPDATE', {
        fileId: files[index].id,
        fileName: files[index].name,
        updates,
        ip: req.ip
    }, req.body.adminUser || 'admin');
    
    res.json({ success: true, data: files[index] });
});

// Delete file
app.delete('/api/files/:id', (req, res) => {
    const files = readDB(DB_FILES.files);
    const index = files.findIndex(f => f.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    const file = files[index];
    
    // Delete physical file
    const filePath = path.join(__dirname, file.filePath);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
    
    files.splice(index, 1);
    writeDB(DB_FILES.files, files);
    
    addLog('FILE_DELETE', {
        fileId: file.id,
        fileName: file.name,
        ip: req.ip
    }, req.query.adminUser || 'admin');
    
    res.json({ success: true, message: 'File deleted' });
});

// Download file and track count
app.get('/api/download/:id', (req, res) => {
    const files = readDB(DB_FILES.files);
    const index = files.findIndex(f => f.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }
    
    const file = files[index];
    const filePath = path.join(__dirname, file.filePath);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Physical file not found' });
    }
    
    // Increment download count
    files[index].downloadCount = (files[index].downloadCount || 0) + 1;
    files[index].lastDownload = new Date().toISOString();
    writeDB(DB_FILES.files, files);
    
    addLog('FILE_DOWNLOAD', {
        fileId: file.id,
        fileName: file.name,
        downloadCount: files[index].downloadCount,
        ip: req.ip
    });
    
    // Update stats
    updateStats('download', file.category);
    
    res.download(filePath, file.fileName);
});

// ============================================
// Logs API
// ============================================
app.get('/api/logs', (req, res) => {
    const logs = readDB(DB_FILES.logs);
    const { action, user, page = 1, limit = 100 } = req.query;
    
    let filtered = logs;
    
    if (action) {
        filtered = filtered.filter(l => l.action === action);
    }
    
    if (user) {
        filtered = filtered.filter(l => l.user.toLowerCase().includes(user.toLowerCase()));
    }
    
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginated = filtered.slice(startIndex, endIndex);
    
    res.json({
        success: true,
        data: paginated,
        pagination: {
            total: filtered.length,
            page: parseInt(page),
            limit: parseInt(limit)
        }
    });
});

app.delete('/api/logs', (req, res) => {
    writeDB(DB_FILES.logs, []);
    addLog('LOGS_CLEARED', { ip: req.ip }, req.query.adminUser || 'admin');
    res.json({ success: true, message: 'Logs cleared' });
});

// ============================================
// Statistics API
// ============================================
app.get('/api/stats', (req, res) => {
    const files = readDB(DB_FILES.files);
    const logs = readDB(DB_FILES.logs);
    const stats = readDB(DB_FILES.stats);
    
    // Calculate stats
    const totalFiles = files.length;
    const totalDownloads = files.reduce((sum, f) => sum + (f.downloadCount || 0), 0);
    
    // Files by category
    const byCategory = {};
    files.forEach(f => {
        byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    });
    
    // Top downloaded files
    const topDownloaded = [...files]
        .sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0))
        .slice(0, 10);
    
    // Recent uploads
    const recentUploads = [...files]
        .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate))
        .slice(0, 10);
    
    // Uploads by user
    const byUser = {};
    files.forEach(f => {
        const user = f.uploadedBy || 'Anonymous';
        byUser[user] = (byUser[user] || 0) + 1;
    });
    
    // Recent activity
    const recentLogs = logs.slice(0, 20);
    
    // Daily stats for chart (last 7 days)
    const dailyStats = getDailyStats(files, logs);
    
    res.json({
        success: true,
        data: {
            totalFiles,
            totalDownloads,
            byCategory,
            topDownloaded,
            recentUploads,
            byUser,
            recentLogs,
            dailyStats
        }
    });
});

// Get upload chart data
app.get('/api/stats/uploads', (req, res) => {
    const files = readDB(DB_FILES.files);
    
    // Group by user
    const byUser = {};
    files.forEach(f => {
        const user = f.uploadedBy || 'Anonymous';
        if (!byUser[user]) {
            byUser[user] = { uploads: 0, downloads: 0 };
        }
        byUser[user].uploads++;
        byUser[user].downloads += f.downloadCount || 0;
    });
    
    // Convert to array for chart
    const chartData = Object.entries(byUser).map(([name, data]) => ({
        name,
        uploads: data.uploads,
        downloads: data.downloads
    })).sort((a, b) => b.uploads - a.uploads);
    
    res.json({ success: true, data: chartData });
});

// ============================================
// Helper Functions
// ============================================
function generateTitleId() {
    return '00040000' + Math.random().toString(16).substr(2, 8).toUpperCase();
}

function calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err) => reject(err));
    });
}

function updateStats(action, category) {
    const stats = readDB(DB_FILES.stats);
    const today = new Date().toISOString().split('T')[0];
    
    let todayStats = stats.find(s => s.date === today);
    if (!todayStats) {
        todayStats = { date: today, uploads: 0, downloads: 0, byCategory: {} };
        stats.push(todayStats);
    }
    
    if (action === 'upload') {
        todayStats.uploads++;
        todayStats.byCategory[category] = (todayStats.byCategory[category] || 0) + 1;
    } else if (action === 'download') {
        todayStats.downloads++;
    }
    
    // Keep only last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const filtered = stats.filter(s => new Date(s.date) >= thirtyDaysAgo);
    
    writeDB(DB_FILES.stats, filtered);
}

function getDailyStats(files, logs) {
    const days = 7;
    const result = [];
    
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        const dayUploads = files.filter(f => 
            f.uploadDate && f.uploadDate.startsWith(dateStr)
        ).length;
        
        const dayDownloads = logs.filter(l => 
            l.action === 'FILE_DOWNLOAD' && l.timestamp.startsWith(dateStr)
        ).length;
        
        result.push({
            date: dateStr,
            label: date.toLocaleDateString('en-US', { weekday: 'short' }),
            uploads: dayUploads,
            downloads: dayDownloads
        });
    }
    
    return result;
}

// ============================================
// Error Handling
// ============================================
app.use((err, req, res, next) => {
    console.error(err.stack);
    
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                success: false, 
                error: 'File too large. Maximum size is 5GB.' 
            });
        }
    }
    
    res.status(500).json({ success: false, error: err.message });
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║         3DS eShop Clone Server                ║
║═══════════════════════════════════════════════║
║  Running on: http://localhost:${PORT}           ║
║  Admin Panel: http://localhost:${PORT}/admin.html║
╚═══════════════════════════════════════════════╝
    `);
    
    // Initialize database files
    Object.values(DB_FILES).forEach(file => {
        if (!fs.existsSync(file)) {
            writeDB(file, []);
        }
    });
    
    addLog('SERVER_START', { port: PORT });
});
