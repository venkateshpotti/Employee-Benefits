

// 1. IMPORT MODULES
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');

// --- CONFIGURE YOUR DATABASE HERE ---
const dbConfig = {
    user: 'postgres',
    host: 'localhost',
    database: 'benefits_db',
    password: '1234',
    port: 5432,
};
// ------------------------------------

// 2. INITIALIZE APP AND DATABASE POOL
const app = express();
const PORT = 3000;
const pool = new Pool(dbConfig);

// 3. CONFIGURE MIDDLEWARE
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 4. DATABASE SETUP FUNCTION 
const setupDatabase = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`
            CREATE TABLE IF NOT EXISTS benefits (
                id SERIAL PRIMARY KEY,
                benefit_name VARCHAR(100) NOT NULL UNIQUE,
                category VARCHAR(50) NOT NULL,
                provider VARCHAR(100),
                description TEXT NOT NULL,
                link VARCHAR(255)
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS benefit_enrollments (
                enrollment_id SERIAL PRIMARY KEY,
                employee_id VARCHAR(50) NOT NULL,
                employee_name VARCHAR(100) NOT NULL,
                benefit_id INTEGER NOT NULL REFERENCES benefits(id),
                enrollment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(20) DEFAULT 'Pending',
                UNIQUE(employee_id, benefit_id)
            );
        `);
        console.log("✅ All tables are ready.");
        const sampleBenefits = [
            { name: 'Health Insurance Plan', cat: 'Health & Wellness', prov: 'BlueCross', desc: 'Comprehensive medical, dental, and vision coverage.', link: '#' },
            { name: '401(k) Retirement Plan', cat: 'Financial', prov: 'Fidelity', desc: 'Company-matching contributions up to 5%.', link: '#' },
            { name: 'Paid Time Off (PTO)', cat: 'Time Off', prov: 'Internal', desc: 'Generous vacation, sick leave, and personal days.', link: '#' },
            { name: 'Professional Development', cat: 'Career', prov: 'Udemy', desc: 'Access to online courses and a yearly conference budget.', link: '#' }
        ];
        for (const benefit of sampleBenefits) {
            await client.query(
                `INSERT INTO benefits (benefit_name, category, provider, description, link)
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (benefit_name) DO NOTHING`,
                [benefit.name, benefit.cat, benefit.prov, benefit.desc, benefit.link]
            );
        }
        console.log("✅ Sample benefits data checked/inserted.");
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Error setting up database:", err);
        process.exit(1);
    } finally {
        client.release();
    }
};

// 5. DEFINE API ROUTES

// --- Employee-Facing Routes ---
app.get('/api/benefits', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM benefits ORDER BY category, benefit_name');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ message: 'Failed to fetch benefits.' }); }
});

app.post('/api/enroll', async (req, res) => {
    const { employee_id, employee_name, benefit_id } = req.body;

    if (!employee_id || !employee_name || !benefit_id) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    
    try {
        
        await pool.query(
            'INSERT INTO benefit_enrollments (employee_id, employee_name, benefit_id, status) VALUES ($1, $2, $3, $4)',
            [employee_id, employee_name, benefit_id, 'Pending']
        );
        res.status(201).json({ success: true, message: 'Enrollment submitted for HR approval!' });
    } catch (err) {
        if (err.code === '23505') { // Unique violation code
            return res.status(409).json({ success: false, message: 'You have already submitted an enrollment for this benefit.' });
        }
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error during enrollment.' });
    }
});


app.get('/api/enrollments/:employeeId', async (req, res) => {
    try {
        const { employeeId } = req.params;
        const result = await pool.query(
            `SELECT b.benefit_name, b.category, e.enrollment_date, e.status
             FROM benefit_enrollments e
             JOIN benefits b ON e.benefit_id = b.id
             WHERE e.employee_id = $1 AND e.status = 'Approved'
             ORDER BY e.enrollment_date DESC`,
            [employeeId]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ message: 'Failed to fetch enrollments.' }); }
});

// --- HR-Facing Routes ---
app.get('/api/hr/enrollments', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT e.enrollment_id, e.employee_id, e.employee_name, b.benefit_name, e.enrollment_date, e.status
             FROM benefit_enrollments e JOIN benefits b ON e.benefit_id = b.id
             ORDER BY CASE e.status WHEN 'Pending' THEN 1 ELSE 2 END, e.enrollment_date DESC`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ message: 'Failed to fetch HR enrollments.' }); }
});

app.post('/api/hr/update-status', async (req, res) => {
    const { enrollment_id, status } = req.body;
    if (!enrollment_id || !status || !['Approved', 'Denied'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid request data.' });
    }
    try {
        const result = await pool.query(
            'UPDATE benefit_enrollments SET status = $1 WHERE enrollment_id = $2 RETURNING enrollment_id',
            [status, enrollment_id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Enrollment not found.' });
        }
        res.json({ success: true, message: `Enrollment status updated to ${status}.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error while updating status.' });
    }
});


// 6. START THE SERVER
const startServer = async () => {
    await setupDatabase();
    app.listen(PORT, () => console.log(`🚀 Server is running on http://localhost:${PORT}`));
};

startServer();
