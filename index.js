#!/usr/bin/env nodejs

const util = require('util')
const express = require('express')
const cheerio = require('cheerio');
const conf = require('./conf');
const helpers = require('./helpers');
const fetchmail = require('./fetchmail');
const ldap = require('./ldap');

const setTimeoutPromise = util.promisify(setTimeout);

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
            if (response.body.includes('Identifiant de connexion non trouvé(e)')) {
                throw `unknown eppn`;
            }
            const m = response.body.match(/<div id='error_explanation'>[\s\S]*<\/div>/);
            if (m) {
                console.error(response.statusCode, m[0]);
                throw m[0]
            }
            in_progress[eppn] = new Date();
        })
    });
}

const ldap2fcmId = {
    "givenName": [ "profile_name" ],
    "sn": [ "profile_lastname" ],
    "supannCivilite": [ "profile_civility", "profile_gender" ],
    "up1BirthDay": [ "profile_birthday" ],
    "eduPersonPrincipalName": [ "profile_sbt_login" ],
    "mail": [ "profile_professional_email" ],
    "mobile": [ "profile_professional_mobile" ],
    "telephoneNumber": [ "profile_professional_landline" ],
};

function convert_ldap_to_fcm(ldapUser) {
    const to_simplename = (s) => s.normalize('NFD').replace(/[^a-z0-9]+/gi, ' ').replace(/^ +| +$/g, '')
    const civility_to_english = { "M.": "mr", "Mme": "mrs", "Mlle": "miss" }
    const civilite2gender = { "M.": "male", "Mme": "female", "Mlle": "female" }
    const format_phone = (s) => s.replace(/[ .-]/g, '')
    const convertions = {
        "profile_birthday": (s) => s.replace(/^(\d\d\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3"),
        "profile_civility": (s) => civility_to_english[s],
        "profile_gender": (s) => civilite2gender[s],
        "profile_professional_landline": format_phone,
        "profile_professional_mobile": format_phone,
        "profile_name": to_simplename,
        "profile_lastname": to_simplename,
    }
    let r = {};
    for (let attr in ldapUser) {
        for (let fcmId of ldap2fcmId[attr] || []) {
            const convert = convertions[fcmId] || (s => s);
            r[fcmId] = convert(ldapUser[attr]) || '';
        }
    }
    r.profile_category = "Employee";
    return r;
}

function create_user_raw(navigation, fcmUser) {
    navigation.request({
        url: `${conf.fcm_base_url}profiles/management/profiles/new`,
    }).then(html => {
        //console.log('create_user_raw', html)
        const $ = cheerio.load(html);
        for (let id in fcmUser) $("#" + id).val(fcmUser[id]);
        return navigation.submit($("form"), conf_raw_request).then(response => {
            const m = response.body.match(/Une erreur est survenue. Votre profil n&#39;a pu être enregistré[\s\S]*?<\/div>/);
            if (m) {
                console.error(m[0])
                throw m[0]
            } else if (response.statusCode === 302) {
                // it should be ok
            } else {
                console.error("create_user failed", response.status);
                console.log(response.body);
                throw "create_user failed"
            }
        })
    })
}

function create_user(eppn) {
    const filter = `(eduPersonPrincipalName=${eppn})`
    return ldap.searchOne(conf.ldap.people_base, { filter, attributes: Object.keys(ldap2fcmId) }).then(convert_ldap_to_fcm).then(fcmUser => {
        console.log(fcmUser);
        const navigation = helpers.new_navigation()
        return login(conf.uid2eppn(conf.admin_uid), navigation).then(response => {
            //console.log(response);
            return create_user_raw(navigation, fcmUser);
        })
    }).catch(err => {         
        throw err === 'not found' ? `user ${eppn} not found in LDAP ?!` : err
    })
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
function login(eppn, navigation) {
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

const trigger_mail_with_modify_password_link_maybe_create_user = (eppn) => (
    trigger_mail_with_modify_password_link(eppn).catch(err => {
        if (err === "unknown eppn") {
            console.log("trying to create user " + eppn + " in FCM")
            return create_user(eppn).then(_ => setTimeoutPromise(_ => trigger_mail_with_modify_password_link(eppn), 1000))
        } else {
            throw err
        }
    })
)

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
    login(eppn, helpers.new_navigation()).then(response => {
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
        if (is_in_progress(eppn)) {
            warn_please_wait(res);
        } else {
            console.log("trigger_mail_with_modify_password_link", eppn);
            trigger_mail_with_modify_password_link_maybe_create_user(eppn).then(_ => {
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