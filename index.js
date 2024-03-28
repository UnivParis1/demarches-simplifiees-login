#!/usr/bin/env nodejs

const fs = require('fs')
const express = require('express')
const cheerio = require('cheerio');
const conf = require('./conf');
const helpers = require('./helpers');
const fetchmail = require('./fetchmail');
const ldap = require('./ldap');

const get_user_password = (mail) => (
    helpers.sha256(mail + conf.common_password_part)
);

const conf_raw_request = { 
    simple: false, followRedirects: false, 
    resolveWithFullResponse: true,
};

let in_progress = {};

/**
 * @param {string} uid 
 */
function is_in_progress(uid) {
    const in_progress_since = in_progress[uid];
    if (!in_progress_since) {
        return false;
    }
    if (in_progress_since.getTime() + conf.in_progress_ttl_minutes * 60 * 1000 < new Date().getTime()) {
        console.error("giving up waiting for uid " + uid)
        delete in_progress[uid];
        return false;
    } else {
        return true;
    }
}

/**
 * @param {string} mail 
 */
function trigger_mail_with_modify_password_link(mail) {
    const navigation = helpers.new_navigation();
    return navigation.request({
        url: `${conf.ds_base_url}set_password`,
    }).then(html => {
        const $ = cheerio.load(html);
        $("#profile_sbt_login").val(mail);
        return navigation.submit($("form"), conf_raw_request).then(response => {
            if (response.body.includes('Identifiant de connexion non trouvé(e)')) {
                throw `unknown mail`;
            }
            const m = response.body.match(/<div id='error_explanation'>[\s\S]*<\/div>/);
            if (m) {
                console.error(response.statusCode, m[0]);
                throw m[0]
            }
            in_progress[mail] = new Date();
        })
    });
}

function flash_messages(body) {
    const $ = cheerio.load(body)
    return $("#flash_messages").find('*').contents().filter(function() {
        return this.type === 'text';
    }).text().trim(); 
}

/**
 * @param {string} mail 
 * @param {string} url 
 */
function on_modify_password_link(mail, url) {
    console.log("fetchmail: setting password for", mail, "using", url);
    const navigation = helpers.new_navigation();
    navigation.request({ url }).then(html => {
        const $ = cheerio.load(html);
        const password = get_user_password(mail);
        $("#user_password").val(password);
        $("#user_password_confirmation").val(password);
        navigation.submit($("form"), conf_raw_request).then(response => {
            if (response.statusCode === 303) {
                // OK!
            } else {
                console.error("fetchmail: setting password for", mail, "using", url, "failed HTTP", response.statusCode, ":", flash_messages(response.body));
                fs.writeFileSync('/tmp/modify-password-fail.html', response.body)
            }
            delete in_progress[mail];
        });
    });
}

/**
 * @param {string} mail 
 */
function login(mail, navigation) {
    return navigation.request({
        url: `${conf.ds_base_url}users/sign_in`,
    }).then(html => {
        const $ = cheerio.load(html);
        if (!$('form').length) {
            // weird
            console.error("weird", html);
            return { headers: {}, statusCode: 302 };
        }
        const password = get_user_password(mail);
        $("#user_email").val(mail);
        $("#user_password").val(password);
        return navigation.submit($("form"), conf_raw_request).then(response => {
            if (response.statusCode === 302) {
                console.log("successful login", mail);
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
    if (is_in_progress(uid)) {
        return warn_please_wait(res);
    }
    uid2mail(uid).then(mail => (
        login(mail, helpers.new_navigation())
    )).then(response => {
        // success
        response.headers.location = '/'; // force relative to current vhost (our rev proxy)
        res.set(response.headers);
        res.status(response.statusCode).send("redirecting");
    }).catch(response => {
        if (!response.body.match(/Login ou mot de passe incorrect|Votre compte est verrouillé/)) {
            console.error("login failed but weird html", response.statusCode);
	    console.log(response.body);
            res.status(500).send('Internal error in login_or_set_password');
            return;
        }
        if (is_in_progress(uid)) {
            warn_please_wait(res);
        } else {
            console.log("trigger_mail_with_modify_password_link", mail);
            trigger_mail_with_modify_password_link(mail).then(_ => {
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
    Votre compte est en cours de configuration, cela peut prendre plusieurs minutes.
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