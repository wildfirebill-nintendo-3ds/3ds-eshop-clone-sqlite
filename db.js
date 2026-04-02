const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data', 'eshop.db');

let db;

// ============================================
// Initialize Database
// ============================================
function initDatabase() {
    db = new Database(DB_PATH);
    
    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    // Create tables
    createTables();
    
    console.log('SQLite database initialized');
    return db;
}

function createTables() {
    db.exec(`
        -- Files table
        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            titleId TEXT,
            productCode TEXT,
            category TEXT NOT NULL,
            homebrewCategory TEXT,
            vcSystem TEXT,
            region TEXT DEFAULT 'region-global',
            description TEXT,
            size INTEGER,
            fileName TEXT,
            filePath TEXT,
            fileType TEXT,
            sha256 TEXT,
            uploadedBy TEXT DEFAULT 'Anonymous',
            downloadCount INTEGER DEFAULT 0,
            uploadDate TEXT,
            lastModified TEXT,
            icon TEXT
        );

        -- Logs table
        CREATE TABLE IF NOT EXISTS logs (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            action TEXT NOT NULL,
            details TEXT,
            user TEXT,
            ip TEXT
        );

        -- Stats table
        CREATE TABLE IF NOT EXISTS stats (
            date TEXT PRIMARY KEY,
            uploads INTEGER DEFAULT 0,
            downloads INTEGER DEFAULT 0,
            byCategory TEXT DEFAULT '{}'
        );

        -- Seeds table
        CREATE TABLE IF NOT EXISTS seeds (
            titleId TEXT PRIMARY KEY,
            seedValue TEXT NOT NULL,
            downloadCount INTEGER DEFAULT 0
        );

        -- Users table
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            passwordHash TEXT,
            isAdmin INTEGER DEFAULT 0,
            createdAt TEXT
        );
    `);

    // Create indexes
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
        CREATE INDEX IF NOT EXISTS idx_files_titleId ON files(titleId);
        CREATE INDEX IF NOT EXISTS idx_files_uploadedBy ON files(uploadedBy);
        CREATE INDEX IF NOT EXISTS idx_files_uploadDate ON files(uploadDate);
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action);
        CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user);
    `);
}

// ============================================
// Files Operations
// ============================================
const filesDB = {
    getAll(options = {}) {
        const { category, search, page = 1, limit = 50 } = options;
        
        let where = [];
        let params = [];
        
        if (category && category !== 'all') {
            where.push('category = ?');
            params.push(category);
        }
        
        if (search) {
            where.push('(LOWER(name) LIKE ? OR LOWER(titleId) LIKE ?)');
            params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
        }
        
        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
        
        const total = db.prepare(`SELECT COUNT(*) as count FROM files ${whereClause}`).get(...params).count;
        const offset = (page - 1) * limit;
        
        const data = db.prepare(`SELECT * FROM files ${whereClause} ORDER BY uploadDate DESC LIMIT ? OFFSET ?`)
            .all(...params, limit, offset);
        
        return {
            data: data.map(parseFileRow),
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        };
    },

    getById(id) {
        const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
        return row ? parseFileRow(row) : null;
    },

    create(file) {
        const stmt = db.prepare(`
            INSERT INTO files (id, name, titleId, productCode, category, homebrewCategory, vcSystem,
                region, description, size, fileName, filePath, fileType, sha256, uploadedBy,
                downloadCount, uploadDate, lastModified, icon)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            file.id || uuidv4(),
            file.name,
            file.titleId,
            file.productCode || null,
            file.category,
            file.homebrewCategory || null,
            file.vcSystem || null,
            file.region || 'region-global',
            file.description || '',
            file.size || 0,
            file.fileName,
            file.filePath,
            file.fileType,
            file.sha256 || null,
            file.uploadedBy || 'Anonymous',
            file.downloadCount || 0,
            file.uploadDate || new Date().toISOString(),
            file.lastModified || new Date().toISOString(),
            file.icon || null
        );
        
        return file;
    },

    update(id, updates) {
        const allowedFields = ['name', 'titleId', 'productCode', 'description', 'region', 'category',
            'homebrewCategory', 'vcSystem', 'uploadedBy', 'icon'];
        
        const setClauses = [];
        const params = [];
        
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                setClauses.push(`${field} = ?`);
                params.push(updates[field]);
            }
        }
        
        if (setClauses.length === 0) return this.getById(id);
        
        setClauses.push('lastModified = ?');
        params.push(new Date().toISOString());
        params.push(id);
        
        db.prepare(`UPDATE files SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
        
        return this.getById(id);
    },

    delete(id) {
        db.prepare('DELETE FROM files WHERE id = ?').run(id);
    },

    incrementDownload(id) {
        db.prepare('UPDATE files SET downloadCount = downloadCount + 1 WHERE id = ?').run(id);
    },

    getStats() {
        const totalFiles = db.prepare('SELECT COUNT(*) as count FROM files').get().count;
        const totalDownloads = db.prepare('SELECT COALESCE(SUM(downloadCount), 0) as total FROM files').get().total;
        
        const byCategory = {};
        db.prepare('SELECT category, COUNT(*) as count FROM files GROUP BY category').all()
            .forEach(row => { byCategory[row.category] = row.count; });
        
        const topDownloaded = db.prepare('SELECT * FROM files ORDER BY downloadCount DESC LIMIT 10').all().map(parseFileRow);
        const recentUploads = db.prepare('SELECT * FROM files ORDER BY uploadDate DESC LIMIT 10').all().map(parseFileRow);
        
        const byUser = {};
        db.prepare('SELECT uploadedBy, COUNT(*) as count FROM files GROUP BY uploadedBy').all()
            .forEach(row => { byUser[row.uploadedBy] = row.count; });
        
        return {
            totalFiles,
            totalDownloads,
            byCategory,
            topDownloaded,
            recentUploads,
            byUser
        };
    },

    getUploadsByUser() {
        return db.prepare(`
            SELECT uploadedBy as name, COUNT(*) as uploads, COALESCE(SUM(downloadCount), 0) as downloads
            FROM files GROUP BY uploadedBy ORDER BY uploads DESC
        `).all();
    }
};

// ============================================
// Logs Operations
// ============================================
const logsDB = {
    add(action, details, user = 'system', ip = 'unknown') {
        const log = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            action,
            details: typeof details === 'object' ? JSON.stringify(details) : details,
            user,
            ip
        };
        
        db.prepare('INSERT INTO logs (id, timestamp, action, details, user, ip) VALUES (?, ?, ?, ?, ?, ?)')
            .run(log.id, log.timestamp, log.action, log.details, log.user, log.ip);
        
        // Keep only last 1000 logs
        db.prepare(`
            DELETE FROM logs WHERE id NOT IN (
                SELECT id FROM logs ORDER BY timestamp DESC LIMIT 1000
            )
        `).run();
        
        console.log(`[${log.timestamp}] ${action}: ${log.details}`);
        return log;
    },

    getAll(options = {}) {
        const { action, user, page = 1, limit = 100 } = options;
        
        let where = [];
        let params = [];
        
        if (action) {
            where.push('action = ?');
            params.push(action);
        }
        
        if (user) {
            where.push('LOWER(user) LIKE ?');
            params.push(`%${user.toLowerCase()}%`);
        }
        
        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
        
        const total = db.prepare(`SELECT COUNT(*) as count FROM logs ${whereClause}`).get(...params).count;
        const offset = (page - 1) * limit;
        
        const data = db.prepare(`SELECT * FROM logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
            .all(...params, limit, offset);
        
        return {
            data: data.map(parseLogRow),
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit)
            }
        };
    },

    clear() {
        db.prepare('DELETE FROM logs').run();
    },

    getRecent(limit = 20) {
        return db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?').all(limit).map(parseLogRow);
    },

    getDailyStats(days = 7) {
        const result = [];
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            const uploads = db.prepare("SELECT COUNT(*) as count FROM logs WHERE action = 'FILE_UPLOAD' AND date(timestamp) = ?").get(dateStr).count;
            const downloads = db.prepare("SELECT COUNT(*) as count FROM logs WHERE action = 'FILE_DOWNLOAD' AND date(timestamp) = ?").get(dateStr).count;
            
            result.push({
                date: dateStr,
                label: date.toLocaleDateString('en-US', { weekday: 'short' }),
                uploads,
                downloads
            });
        }
        return result;
    }
};

// ============================================
// Stats Operations
// ============================================
const statsDB = {
    update(action, category) {
        const today = new Date().toISOString().split('T')[0];
        
        const existing = db.prepare('SELECT * FROM stats WHERE date = ?').get(today);
        
        if (existing) {
            let byCategory = JSON.parse(existing.byCategory || '{}');
            if (action === 'upload') {
                byCategory[category] = (byCategory[category] || 0) + 1;
            }
            
            db.prepare(`UPDATE stats SET 
                uploads = uploads + ?, 
                downloads = downloads + ?,
                byCategory = ?
                WHERE date = ?`)
                .run(
                    action === 'upload' ? 1 : 0,
                    action === 'download' ? 1 : 0,
                    JSON.stringify(byCategory),
                    today
                );
        } else {
            let byCategory = {};
            if (action === 'upload') {
                byCategory[category] = 1;
            }
            
            db.prepare('INSERT INTO stats (date, uploads, downloads, byCategory) VALUES (?, ?, ?, ?)')
                .run(today, action === 'upload' ? 1 : 0, action === 'download' ? 1 : 0, JSON.stringify(byCategory));
        }
        
        // Clean old stats (keep 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        db.prepare('DELETE FROM stats WHERE date < ?').run(thirtyDaysAgo.toISOString().split('T')[0]);
    },

    getAll() {
        return db.prepare('SELECT * FROM stats ORDER BY date DESC').all();
    }
};

// ============================================
// Seeds Operations
// ============================================
const seedsDB = {
    getAll(options = {}) {
        const { search, page = 1, limit = 100 } = options;
        
        let where = [];
        let params = [];
        
        if (search) {
            where.push('LOWER(titleId) LIKE ?');
            params.push(`%${search.toLowerCase()}%`);
        }
        
        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
        
        const total = db.prepare(`SELECT COUNT(*) as count FROM seeds ${whereClause}`).get(...params).count;
        const offset = (page - 1) * limit;
        
        const data = db.prepare(`SELECT * FROM seeds ${whereClause} ORDER BY titleId ASC LIMIT ? OFFSET ?`)
            .all(...params, limit, offset);
        
        return {
            data,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        };
    },

    getByTitleId(titleId) {
        return db.prepare('SELECT * FROM seeds WHERE titleId = ?').get(titleId.toUpperCase());
    },

    upsert(titleId, seedValue) {
        db.prepare(`
            INSERT INTO seeds (titleId, seedValue, downloadCount)
            VALUES (?, ?, 0)
            ON CONFLICT(titleId) DO UPDATE SET seedValue = excluded.seedValue
        `).run(titleId.toUpperCase(), seedValue);
    },

    incrementDownload(titleId) {
        db.prepare('UPDATE seeds SET downloadCount = downloadCount + 1 WHERE titleId = ?').run(titleId.toUpperCase());
    },

    bulkInsert(seeds) {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO seeds (titleId, seedValue, downloadCount)
            VALUES (?, ?, 0)
        `);
        
        const insertMany = db.transaction((seedsList) => {
            let count = 0;
            for (const seed of seedsList) {
                const result = stmt.run(seed.titleId.toUpperCase(), seed.seedValue);
                if (result.changes > 0) count++;
            }
            return count;
        });
        
        return insertMany(seeds);
    },

    getStats() {
        const totalSeeds = db.prepare('SELECT COUNT(*) as count FROM seeds').get().count;
        const totalDownloads = db.prepare('SELECT COALESCE(SUM(downloadCount), 0) as total FROM seeds').get().total;
        const topSeeds = db.prepare('SELECT * FROM seeds WHERE downloadCount > 0 ORDER BY downloadCount DESC LIMIT 10').all();
        
        return { totalSeeds, totalDownloads, topSeeds };
    }
};

// ============================================
// Row Parsers (convert SQLite rows to API format)
// ============================================
function parseFileRow(row) {
    return {
        ...row,
        size: row.size || 0,
        downloadCount: row.downloadCount || 0
    };
}

function parseLogRow(row) {
    return {
        ...row,
        details: row.details ? JSON.parse(row.details) : {}
    };
}

// ============================================
// Migration from JSON
// ============================================
function migrateFromJSON(dataDir) {
    const fs = require('fs');
    
    console.log('Starting migration from JSON to SQLite...');
    
    // Migrate files
    const filesPath = path.join(dataDir, 'db', 'files.json');
    if (fs.existsSync(filesPath)) {
        const files = JSON.parse(fs.readFileSync(filesPath, 'utf8'));
        const insert = db.prepare(`
            INSERT OR REPLACE INTO files (id, name, titleId, productCode, category, homebrewCategory, vcSystem,
                region, description, size, fileName, filePath, fileType, sha256, uploadedBy,
                downloadCount, uploadDate, lastModified, icon)
            VALUES (@id, @name, @titleId, @productCode, @category, @homebrewCategory, @vcSystem,
                @region, @description, @size, @fileName, @filePath, @fileType, @sha256, @uploadedBy,
                @downloadCount, @uploadDate, @lastModified, @icon)
        `);
        
        const insertMany = db.transaction((filesList) => {
            for (const file of filesList) {
                insert.run({
                    id: file.id,
                    name: file.name,
                    titleId: file.titleId || null,
                    productCode: file.productCode || null,
                    category: file.category,
                    homebrewCategory: file.homebrewCategory || null,
                    vcSystem: file.vcSystem || null,
                    region: file.region || 'region-global',
                    description: file.description || '',
                    size: file.size || 0,
                    fileName: file.fileName || null,
                    filePath: file.filePath || null,
                    fileType: file.fileType || null,
                    sha256: file.sha256 || null,
                    uploadedBy: file.uploadedBy || 'Anonymous',
                    downloadCount: file.downloadCount || 0,
                    uploadDate: file.uploadDate || new Date().toISOString(),
                    lastModified: file.lastModified || new Date().toISOString(),
                    icon: file.icon || null
                });
            }
        });
        
        insertMany(files);
        console.log(`Migrated ${files.length} files`);
    }
    
    // Migrate logs
    const logsPath = path.join(dataDir, 'db', 'logs.json');
    if (fs.existsSync(logsPath)) {
        const logs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
        const insert = db.prepare(`
            INSERT OR REPLACE INTO logs (id, timestamp, action, details, user, ip)
            VALUES (@id, @timestamp, @action, @details, @user, @ip)
        `);
        
        const insertMany = db.transaction((logsList) => {
            for (const log of logsList) {
                insert.run({
                    id: log.id,
                    timestamp: log.timestamp,
                    action: log.action,
                    details: typeof log.details === 'object' ? JSON.stringify(log.details) : log.details,
                    user: log.user || 'system',
                    ip: log.ip || 'unknown'
                });
            }
        });
        
        insertMany(logs);
        console.log(`Migrated ${logs.length} logs`);
    }
    
    // Migrate stats
    const statsPath = path.join(dataDir, 'db', 'stats.json');
    if (fs.existsSync(statsPath)) {
        const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
        const insert = db.prepare(`
            INSERT OR REPLACE INTO stats (date, uploads, downloads, byCategory)
            VALUES (@date, @uploads, @downloads, @byCategory)
        `);
        
        const insertMany = db.transaction((statsList) => {
            for (const stat of statsList) {
                insert.run({
                    date: stat.date,
                    uploads: stat.uploads || 0,
                    downloads: stat.downloads || 0,
                    byCategory: typeof stat.byCategory === 'object' ? JSON.stringify(stat.byCategory) : stat.byCategory
                });
            }
        });
        
        insertMany(stats);
        console.log(`Migrated ${stats.length} stats`);
    }
    
    // Migrate seeds
    const seedsPath = path.join(dataDir, 'db', 'seeds.json');
    if (fs.existsSync(seedsPath)) {
        const seeds = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
        const insert = db.prepare(`
            INSERT OR REPLACE INTO seeds (titleId, seedValue, downloadCount)
            VALUES (@titleId, @seedValue, @downloadCount)
        `);
        
        const insertMany = db.transaction((seedsList) => {
            for (const seed of seedsList) {
                insert.run({
                    titleId: seed.titleId.toUpperCase(),
                    seedValue: seed.seedValue,
                    downloadCount: seed.downloadCount || 0
                });
            }
        });
        
        insertMany(seeds);
        console.log(`Migrated ${seeds.length} seeds`);
    }
    
    console.log('Migration complete!');
}

// ============================================
// Close Database
// ============================================
function closeDatabase() {
    if (db) {
        db.close();
    }
}

module.exports = {
    initDatabase,
    closeDatabase,
    migrateFromJSON,
    filesDB,
    logsDB,
    statsDB,
    seedsDB
};
