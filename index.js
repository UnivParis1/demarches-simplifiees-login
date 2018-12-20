const express = require('express')
const cheerio = require('cheerio');
const conf = require('./conf');
const helpers = require('./helpers');
const fetchmail = require('./fetchmail');

const get_user_password = (eppn) => (
    helpers.sha256(eppn + conf.common_password_part)
);

const conf_raw_request = { 
    simple: false, followRedirects: false, 
    resolveWithFullResponse: true,
};

let in_progress = {};

/**
 * @param {string} eppn 
 */
function is_in_progress(eppn) {
    const in_progress_since = in_progress[eppn];
    if (!in_progress_since) {
        return false;
    }
    if (in_progress_since.getTime() + conf.in_progress_ttl_minutes * 60 * 1000 < new Date().getTime()) {
        console.error("giving up waiting for mail " + eppn)
        delete in_progress[eppn];
        return false;
    } else {
        return true;
    }
}

/**
 * @param {string} eppn 
 */
function trigger_mail_with_modify_password_link(eppn) {
    const navigation = helpers.new_navigation();
    return navigation.request({
        url: `${conf.fcm_base_url}set_password`,
    }).then(html => {
        const $ = cheerio.load(html);
        $("#profile_sbt_login").val(eppn);
        return navigation.submit($("form"), conf_raw_request).then(response => {
            if (response.body.match("<div id='error_explanation'>")) {
                console.error(response.statusCode, response.body);
                throw `FCM does not know eppn ${eppn}?`;
            }
            in_progress[eppn] = new Date();
        })
    });
}

/**
 * @param {string} eppn 
 * @param {string} url 
 */
function on_modify_password_link(eppn, url) {
    console.log("fetchmail: setting password for", eppn, "using", url);
    url = url.replace(/^http:\/\//, 'https://');
    const navigation = helpers.new_navigation();
    navigation.request({ url }).then(html => {
        const $ = cheerio.load(html);
        const password = get_user_password(eppn);
        $("#profile_password").val(password);
        $("#profile_password_confirmation").val(password);
        navigation.submit($("form"), conf_raw_request).then(_ => {
            delete in_progress[eppn];
        });
    });
}

/**
 * @param {string} eppn 
 */
function login(eppn) {
    const navigation = helpers.new_navigation();
    return navigation.request({
        url: `${conf.fcm_base_url}profiles/sign_in`,
    }).then(html => {
        const $ = cheerio.load(html);
        if (!$('form').length) {
            // weird
            console.error("weird", html);
            return { headers: {}, statusCode: 302 };
        }
        const password = get_user_password(eppn);
        $("#profile_sbt_login").val(eppn);
        $("#profile_password").val(password);
        return navigation.submit($("form"), conf_raw_request).then(response => {
            if (response.statusCode === 302) {
                console.log("successful login", eppn);
                return response;
            } else {
                throw response;
            }
        });
    });
}

/**
 * @param {Request} req 
 * @param {Response} res 
 */
function login_or_set_password(req, res) {
    const uid = req.header('REMOTE_USER'); 
    if (!uid) return res.send("missing REMOTE_USER");
    const eppn = conf.uid2eppn(uid);
    if (is_in_progress(eppn)) {
        return warn_please_wait(res);
    }
    login(eppn).then(response => {
        // success
        response.headers.location = '/'; // force relative to current vhost (our rev proxy)
        res.set(response.headers);
        res.status(response.statusCode).send("redirecting");
    }).catch(response => {
        if (!response.body.match('Login ou mot de passe incorrect')) {
            console.error(response.statusCode, response.body);
            res.status(500).send('Internal error in login_or_set_password');
            return;
        }
        if (is_in_progress(eppn)) {
            warn_please_wait(res);
        } else {
            console.log("trigger_mail_with_modify_password_link", eppn);
            trigger_mail_with_modify_password_link(eppn).then(_ => {
                warn_please_wait(res);
            }).catch(err => {
                res.status(500).send(err);
            });
        }        
    });
}

/**
 * @param {Response} res 
 */
function warn_please_wait(res) {
    res.send(`
<html>
  <meta http-equiv="refresh" content="10">
  <body>
  <div style="margin: 1rem">
    Votre compte est en cours de création, cela peut prendre plusieurs minutes.
    Veuillez patienter...
  </div>
</body></html>`);
}


function start_http_server() {
    const app = express()
    
    app.get('/', login_or_set_password);
    app.listen(conf.http_server.port, () => console.log(`Started on port ${conf.http_server.port}!`))
}

fetchmail(on_modify_password_link);
start_http_server();