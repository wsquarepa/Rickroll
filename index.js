import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cookieParser from "cookie-parser";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import crypto from "crypto";

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.DOMAIN || "example.com";
const REDIRECT_URL = process.env.REDIRECT_URL || "https://www.youtube.com/watch?v=dQw4w9WgXcQ?autoplay=1";
const VISITOR_ID_COOKIE_NAME = process.env.VISITOR_ID_COOKIE_NAME || "visitor_id";
const WEBVIEWER = {
    HOST: process.env.WEBVIEWER_HOST,
    PATH: process.env.WEBVIEWER_PATH,
    IPS: process.env.WEBVIEWER_IPS ? process.env.WEBVIEWER_IPS.split(",") : [],
    MAX_SHOWN: process.env.WEBVIEWER_MAX_SHOWN || 20,
};
const PROXYCHECK_API_KEY = process.env.PROXYCHECK_API_KEY;

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");
app.set("views", "src/views");

app.disable("x-powered-by");

const db = new sqlite3.Database("database.sqlite");

async function get(query, params) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(row);
        });
    });
}

async function all(query, params) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(rows);
        });
    });
}

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS ips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        countryCode TEXT NOT NULL,
        vpn BOOLEAN DEFAULT FALSE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        url TEXT NOT NULL,
        method TEXT NOT NULL,
        useragent TEXT NOT NULL,
        visitorId TEXT NOT NULL,
        uniqueHost TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// global middleware

// robots.txt disallow all. prevents search engines from indexing the site and following links
app.get("/robots.txt", (req, res) => {
    res.type("text/plain");
    res.send("User-agent: *\nDisallow: /");
})

app.use(async (req, res, next) => {
    const ip = req.get("cf-connecting-ip") || req.ip;
    const country = req.get("cf-ipcountry");

    const host = req.get("host");

    if (host === WEBVIEWER.HOST) {
        next();
        return;
    }

    const useragent = req.get("user-agent");
    const url = req.originalUrl;
    const method = req.method;

    // check if ip is in database already
    const ipData = await get(`SELECT * FROM ips WHERE ip = ?`, [ip]);

    if (!ipData && PROXYCHECK_API_KEY) {
        const pcRequest = await fetch(`https://proxycheck.io/v2/${ip}?key=${PROXYCHECK_API_KEY}&vpn=1`);

        if (pcRequest.ok) {
            const pcData = await pcRequest.json();

            db.run(`INSERT INTO ips (ip, countryCode, vpn) VALUES (?, ?, ?)`, [ip, country, pcData[ip].proxy == "yes"]);
        }
    }

    const visitorId = req.cookies[VISITOR_ID_COOKIE_NAME] || crypto.randomBytes(16).toString("hex");

    db.run(`INSERT INTO requests (ip, url, method, useragent, visitorId, uniqueHost) VALUES (?, ?, ?, ?, ?, ?)`, [ip, url, method, useragent, visitorId, host]);

    res.cookie(VISITOR_ID_COOKIE_NAME, visitorId, { maxAge: 900000, httpOnly: true, domain: "." + DOMAIN });

    res.redirect(REDIRECT_URL);
});

// webviewer router

const webviewerRouter = express.Router();

webviewerRouter.use((req, res, next) => {
    const ip = req.get("cf-connecting-ip") || req.ip;

    if (WEBVIEWER.IPS.length > 0 && !WEBVIEWER.IPS.includes(ip)) {
        res.status(403).send("Forbidden");
        return;
    }

    next();
});

webviewerRouter.use("/css", express.static("src/css"));
webviewerRouter.use("/js", express.static("src/js"));

webviewerRouter.get("/", (req, res) => {
    res.render("index", { base_route: WEBVIEWER.PATH });
});

webviewerRouter.post("/visitor", async (req, res) => {
    const visitorId = req.body.visitor;
    const page = parseInt(req.body.page) || 1;
    const offset = (page - 1) * WEBVIEWER.MAX_SHOWN;

    const visitorData = await all(`SELECT * FROM requests WHERE visitorId = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`, [visitorId, WEBVIEWER.MAX_SHOWN, offset]);

    if (!visitorData || visitorData.length === 0) {
        res.render("viewer", { data: [], query: { type: "visitor", data: visitorId, page: page, more: false, base_route: WEBVIEWER.PATH } });
        return;
    }

    res.render("viewer", { data: visitorData, query: { type: "visitor", data: visitorId, page: page, more: true, base_route: WEBVIEWER.PATH } });
});

webviewerRouter.post("/host", async (req, res) => {
    const host = req.body.host;
    const page = parseInt(req.body.page) || 1;
    const offset = (page - 1) * WEBVIEWER.MAX_SHOWN;

    const hostData = await all(`SELECT * FROM requests WHERE uniqueHost = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`, [host, WEBVIEWER.MAX_SHOWN, offset]);

    if (!hostData || hostData.length === 0) {
        res.render("viewer", { data: [], query: { type: "host", data: host, page: page, more: false, base_route: WEBVIEWER.PATH } });
        return;
    }

    res.render("viewer", { data: hostData, query: { type: "host", data: host, page: page, more: true, base_route: WEBVIEWER.PATH } });
});

webviewerRouter.post("/useragent", async (req, res) => {
    // search by fragment only
    const useragent = req.body.useragent;
    const page = parseInt(req.body.page) || 1;
    const offset = (page - 1) * WEBVIEWER.MAX_SHOWN;

    const uaData = await all(`SELECT * FROM requests WHERE useragent LIKE ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`, [`%${useragent}%`, WEBVIEWER.MAX_SHOWN, offset]);

    if (!uaData || uaData.length === 0) {
        res.render("viewer", { data: [], query: { type: "useragent", data: useragent, page: page, more: false, base_route: WEBVIEWER.PATH } });
        return;
    }

    res.render("viewer", { data: uaData, query: { type: "useragent", data: useragent, page: page, more: true, base_route: WEBVIEWER.PATH } });
});

webviewerRouter.post("/ip", async (req, res) => {
    const ip = req.body.ip;
    const page = parseInt(req.body.page) || 1;
    const offset = (page - 1) * WEBVIEWER.MAX_SHOWN;

    const ipData = await all(`SELECT * FROM requests WHERE ip = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`, [ip, WEBVIEWER.MAX_SHOWN, offset]);

    if (!ipData || ipData.length === 0) {
        res.render("viewer", { data: [], query: { type: "ip", data: ip, page: page, more: false, base_route: WEBVIEWER.PATH } });
        return;
    }

    res.render("viewer", { data: ipData, query: { type: "ip", data: ip, page: page, more: true, base_route: WEBVIEWER.PATH } });
});

// utility for webviewer
webviewerRouter.post("/ipinfo", async (req, res) => {
    const ip = req.body.ip;
    const ipData = await get(`SELECT * FROM ips WHERE ip = ?`, [ip]);

    res.json(ipData);
})

app.use(WEBVIEWER.PATH, webviewerRouter);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
