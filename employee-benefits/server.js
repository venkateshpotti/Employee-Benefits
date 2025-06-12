// --- File: server.js ---

// 1. IMPORT MODULES
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

// 2. INITIALIZE APP AND DATABASE POOL
const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// 3. CONFIGURE MIDDLEWARE
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 4. DATABASE SETUP FUNCTION (Manages both tables)
const setupDatabase = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start a transaction

        // Create 'benefits' table
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

        // Create 'benefit_enrollments' table with a foreign key
        await client.query(`
            CREATE TABLE IF NOT EXISTS benefit_enrollments (
                enrollment_id SERIAL PRIMARY KEY,
                employee_id VARCHAR(50) NOT NULL,
                employee_name VARCHAR(100) NOT NULL,
                benefit_id INTEGER NOT NULL REFERENCES benefits(id),
                enrollment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(20) DEFAULT 'Active',
                UNIQUE(employee_id, benefit_id) -- Prevents duplicate enrollments
            );
        `);
        
        console.log("✅ All tables are ready.");

        // Insert sample benefits data (same as before)
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
        
        await client.query('COMMIT'); // Commit the transaction

    } catch (err) {
        await client.query('ROLLBACK'); // Rollback on error
        console.error("❌ Error setting up database:", err);
        process.exit(1);
    } finally {
        client.release();
    }
};

// 5. DEFINE API ROUTES
// GET all available benefits
app.get('/api/benefits', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM benefits ORDER BY category, benefit_name');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ message: 'Failed to fetch benefits.' }); }
});

// POST to enroll in a benefit (from the form)
app.post('/api/enroll', async (req, res) => {
    const { employee_id, employee_name, benefit_id } = req.body;

    if (!employee_id || !employee_name || !benefit_id) {
        return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    
    try {
        await pool.query(
            'INSERT INTO benefit_enrollments (employee_id, employee_name, benefit_id) VALUES ($1, $2, $3)',
            [employee_id, employee_name, benefit_id]
        );
        res.status(201).json({ success: true, message: 'Enrollment successful!' });
    } catch (err) {
        if (err.code === '23505') { // Unique violation code
            return res.status(409).json({ success: false, message: 'You are already enrolled in this benefit.' });
        }
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error during enrollment.' });
    }
});

// GET an employee's current enrollments
app.get('/api/enrollments/:employeeId', async (req, res) => {
    try {
        const { employeeId } = req.params;
        const result = await pool.query(
            `SELECT b.benefit_name, b.category, e.enrollment_date 
             FROM benefit_enrollments e
             JOIN benefits b ON e.benefit_id = b.id
             WHERE e.employee_id = $1
             ORDER BY e.enrollment_date DESC`,
            [employeeId]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ message: 'Failed to fetch enrollments.' }); }
});


// 6. START THE SERVER
const startServer = async () => {
    await setupDatabase();
    app.listen(PORT, () => console.log(`🚀 Server is running on http://localhost:${PORT}`));
};

startServer();