const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// TEST API
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// POST DATA SENSOR
app.post("/api/sensor/:greenhouse_id", (req, res) => {
  const greenhouse_id = req.params.greenhouse_id;
  const { dht_temp, dht_hum, turbidity, water_temp } = req.body;

  const sql = `
    INSERT INTO sensor_data 
    (greenhouse_id, dht_temp, dht_hum, turbidity, water_temp)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [greenhouse_id, dht_temp, dht_hum, turbidity, water_temp],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: result.insertId });
    }
  );
});


app.get("/api/greenhouses/history", (req, res) => {
  const greenhouse_id = req.query.gh;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const date_from = req.query.date_from || weekAgo;
  const date_to = req.query.date_to || new Date().toISOString().slice(0, 19).replace('T', ' ');
  //const limit = req.query.limit || 200; //aktifin kalo perlu limit data

  const sql = `
    SELECT * FROM sensor_data 
    WHERE greenhouse_id = ?
    AND created_at BETWEEN ? AND ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [greenhouse_id, date_from, date_to], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get("/api/greenhouses", (req, res) => {
  const sql = `
    SELECT * FROM greenhouses
  `;

  db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// RUN LOCAL
app.listen(3000, () => console.log("Server running on port 3000"));
