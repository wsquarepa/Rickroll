import dotenv from "dotenv";
dotenv.config();

import fs from "fs";

import express from "express";
import cookieParser from "cookie-parser";
import fetch from "node-fetch";
import Database from "better-sqlite3";
import crypto from "crypto";

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.DOMAIN || "example.com";
const REDIRECT_URL = process.env.REDIRECT_URL || "https://www.youtube.com/watch?v=dQw4w9WgXcQ?autoplay=1";
const VISITOR_ID_COOKIE_NAME = process.env.VISITOR_ID_COOKIE_NAME || "visitor_id";
const VISITOR_ID_COOKIE_SECRET = process.env.VISITOR_ID_COOKIE_SECRET || "secret";
const WEBVIEWER = {
    HOST: process.env.WEBVIEWER_HOST,
    PATH: process.env.WEBVIEWER_PATH,
    IPS: process.env.WEBVIEWER_IPS ? process.env.WEBVIEWER_IPS.split(",") : [],
    MAX_SHOWN: process.env.WEBVIEWER_MAX_SHOWN || 20,
};
const PROXYCHECK_API_KEY = process.env.PROXYCHECK_API_KEY;

if (!fs.existsSync("data")) {
    fs.mkdirSync("data");
}

const db = Database("data/data.db");
db.pragma("journal_mode = WAL");

db.prepare(`
    CREATE TABLE IF NOT EXISTS ip_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip TEXT NOT NULL,
        country TEXT NOT NULL,
        city TEXT NOT NULL,
        provider TEXT NOT NULL,
        vpn BOOLEAN DEFAULT FALSE
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        url TEXT NOT NULL,
        method TEXT NOT NULL,
        useragent TEXT NOT NULL,
        visitorId TEXT NOT NULL,
        host TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`).run();

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");
app.set("views", "src/views");

app.disable("x-powered-by");

// global middleware

// robots.txt disallow all. prevents search engines from indexing the site and following links
app.get("/robots.txt", (req, res) => {
    res.type("text/plain");
    res.send("User-agent: *\nDisallow: /");
});

// favicon.ico redirect to google's favicon service, prevents favicon requests from being logged
app.get("/favicon.ico", (req, res) => {
    res.redirect("https://www.google.com/s2/favicons?domain=example.com");
});

app.use(async (req, res, next) => {
    const ip = req.get("cf-connecting-ip") || req.ip;

    const host = req.get("host");

    if (host === WEBVIEWER.HOST) {
        next();
        return;
    }

    const useragent = req.get("user-agent");
    const url = req.originalUrl;
    const method = req.method;

    // visitor id
    let visitorId = req.cookies[VISITOR_ID_COOKIE_NAME];

    if (visitorId) {
        // validate visitor id
        const visitorIdComponents = visitorId.split(".");
        if (visitorIdComponents.length == 2) {
            visitorId = visitorIdComponents[0];
            const hmac = crypto.createHmac("sha256", VISITOR_ID_COOKIE_SECRET);

            hmac.update(visitorId);

            if (visitorIdComponents[1] != hmac.digest("base64")) {
                visitorId = null;
            }
        } else {
            visitorId = null;
        }
    }

    if (!visitorId) {
        visitorId = crypto.randomBytes(16).toString("hex");
    }

    db.prepare(`INSERT INTO requests (ip, url, method, useragent, visitorId, host) VALUES (?, ?, ?, ?, ?, ?)`).run(ip, url, method, useragent, visitorId, host);

    // set visitor id cookie
    const hmac = crypto.createHmac("sha256", VISITOR_ID_COOKIE_SECRET);
    hmac.update(visitorId);

    res.cookie(VISITOR_ID_COOKIE_NAME, visitorId + "." + hmac.digest("base64"), { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: true, domain: "." + DOMAIN });

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

webviewerRouter.get("/", (req, res) => {
    res.render("index", { base_route: WEBVIEWER.PATH });
});

async function query(field, value, page, fragment = false) {
    const offset = (page - 1) * WEBVIEWER.MAX_SHOWN;
    let queryStr, params;

    if (fragment) {
        queryStr = `SELECT * FROM requests WHERE ${field} LIKE ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
        params = [`%${value}%`, WEBVIEWER.MAX_SHOWN, offset];
    } else {
        queryStr = `SELECT * FROM requests WHERE ${field} = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
        params = [value, WEBVIEWER.MAX_SHOWN, offset];
    }

    let data = db.prepare(queryStr).all(...params);

    if (!data || data.length === 0) {
        data = [];
    }

    // for each data value, get the country code and vpn status
    for (const entry of data) {
        let ipData = db.prepare(`SELECT * FROM ip_cache WHERE ip = ? AND timestamp > datetime('now', '-1 day')`).get(entry.ip);

        if (!ipData && PROXYCHECK_API_KEY) {
            const pcRequest = await fetch(`https://proxycheck.io/v2/${ip}?key=${PROXYCHECK_API_KEY}&vpn=1&asn=1`);

            if (pcRequest.ok) {
                const pcData = await pcRequest.json();

                db.prepare(`INSERT INTO ip_cache (ip, country, city, provider, vpn) VALUES (?, ?, ?, ?, ?)`).run(
                    ip,
                    pcData[ip].country,
                    pcData[ip].city,
                    pcData[ip].provider,
                    pcData[ip].proxy == "yes"
                );

                ipData = {
                    country: pcData[ip].country,
                    city: pcData[ip].city,
                    provider: pcData[ip].provider,
                    vpn: pcData[ip].proxy == "yes"
                };
            }
        }

        if (ipData) {
            entry.ipdata = ipData;

            // flush all entries older than 1 day
            db.prepare(`DELETE FROM ip_cache WHERE timestamp < datetime('now', '-1 day')`).run();
        } else {
            entry.ipdata = {
                country: "N/A",
                city: "N/A",
                provider: "N/A",
                vpn: false
            };   
        }
    }

    return {
        data: data,
        query: {
            type: field,
            data: value,
            page: page,
            more: data.length === WEBVIEWER.MAX_SHOWN,
            base_route: WEBVIEWER.PATH,
        },
    };
}

webviewerRouter.post("/visitor", async (req, res) => {
    const visitorId = req.body.visitor;
    const page = parseInt(req.body.page) || 1;

    res.render("viewer", await query("visitorId", visitorId, page));
});

webviewerRouter.post("/host", async (req, res) => {
    const host = req.body.host;
    const page = parseInt(req.body.page) || 1;

    res.render("viewer", await query("host", host, page));
});

webviewerRouter.post("/useragent", async (req, res) => {
    // search by fragment only
    const useragent = req.body.useragent;
    const page = parseInt(req.body.page) || 1;

    res.render("viewer", await query("useragent", useragent, page, true));
});

webviewerRouter.post("/ip", async (req, res) => {
    const ip = req.body.ip;
    const page = parseInt(req.body.page) || 1;

    res.render("viewer", await query("ip", ip, page));
});

app.use(WEBVIEWER.PATH, webviewerRouter);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
