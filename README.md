# Rickroll
Rickroll Handler + Webviewer for Rickrolled Users

## Features
- Allows wildcard domains (so if you have a random domain you never use you can use it with wildcard)
- .env file for easy configuration
- Webviewer for viewing rickrolled users
- ~~Free spaghetti code! (I spent like no time on this don't expect good code)~~

## Installation
1. Clone the repository
2. Enter the repository directory
3. Run `npm install`
4. Copy `.env.example` to `.env` and configure it (see Configuration)
4. Run `node .` (or start in background with your preferred method)

## Configuration (.env)
- `PORT` - The port the webserver will run on. Default is 8080.
- `DOMAIN` - **YOU MUST CONFIGURE THIS** - The domain you are using. This should be the base domain for cross-domain tracking, if you are using a wildcard record. 
- `REDIRECT_URL` - The URL to redirect to when a user visits your site, in case you don't want to rickroll them or prefer a different url.
- `WEBVIEWER_HOST` - The required host header for the webviewer to work. This is to prevent unauthorized / accidental access to the webviewer. You should probably put this on a separate domain if you are using a wildcard. By default, 
- `WEBVIEWER_PATH` - **YOU MUST CONFIGURE THIS** - The base path to the webviewer. This should be a random path to prevent unauthorized access. Security by obfuscation, baby! (Include the leading `/`. **DO NOT SET IT TO / - THIS MAY BREAK THE REDIRECTS**)
- `WEBVIEWER_IPS` - A comma-separated list of IPs that are allowed to access the webviewer. This is to prevent unauthorized access. If you don't fill this in, the webviewer will be open to any IP.
- `WEBVIEWER_MAX_SHOWN` - The maximum amount of entries you will see at once. If you have a lower-end server, you might want to lower this number. Default is 20 (relatively low).
- `PROXYCHECK_API_KEY` - The API key for ProxyCheck.io. This is used to check if the user is using a proxy. This is only used for the webviewer, and won't block users from being rickrolled. If you don't configure this, the webviewer will not return proxy nor location information.
- `VISITOR_ID_COOKIE_NAME` - The name of the cookie that will be set on the user's browser. This is used to track users across domains. Changing this allows you to better hide the fact that you are tracking them. Default is `visitor_id`.