const fs = require('fs')
const imap_simple = require('imap-simple');
const quotedPrintable = require('quoted-printable');
const sendmail = require('./sendmail')
const conf = require('./conf');

let _on_modify_password_link;

function handle_invite_instructeur(msg) {
    const mail = msg.headers.to?.[0]
    const url = msg.body.match(/(https:\/\/.*\/users\/activate[?]token=\w+)/)?.[1];
    if (mail && url) {
        _on_modify_password_link(mail, url);
        return true
    } else {
        console.error("weird mail", msg.attributes.date);
        return false
    }
}

function handle_reset_password_instructions(msg) {
    const mail = msg.headers.to?.[0]
    const url = msg.body.match(/(https:\/\/.*\/users\/password\/edit[?]reset_password_token=\w+)/)?.[1];
    if (mail && url) {
        _on_modify_password_link(mail, url);
        return true
    } else {
        console.error("weird mail", msg.attributes.date);
        return false
    }
}

let _connection;
function handleMails() {
    _connection.search(['UNSEEN'], { bodies: ['HEADER', 'TEXT'] }).then(msgs => {
        if (msgs.length > 0) console.log("fetchmail:", msgs.length, " new messages");
        for (const raw_msg of msgs) {
            const msg = {
                attributes: raw_msg.attributes,
                headers: raw_msg.parts.find(p => p.which === 'HEADER')?.body,
                body: quotedPrintable.decode(raw_msg.parts.find(p => p.which === 'TEXT')?.body),
            }
            if (!msg.headers || !msg.body) {
                console.error("weird mail", msg.attributes.date);
                next;
            }
            const cmd = msg.headers['x-dolist-message-name']?.[0]
            console.log({cmd}, msg.headers.to)
            let valid = true
            if (cmd === 'invite_instructeur') {
                valid = handle_invite_instructeur(msg)
            } else if (cmd === 'reset_password_instructions') {
                valid = handle_reset_password_instructions(msg)
            } else {
                const body = msg.body.replaceAll(conf.ds_base_url, conf.our_proxy_base_url)
                //console.log(msg.headers)
                fs.writeFileSync('/tmp/mail.eml', body)
                //console.log(body)
                // otherwise sendmail filtered

                const envelope = {
                    from: conf.sendmail.from,
                    to: [msg.headers.to]
                }
                const headers = [ 'From', 'To', 'Content-Type', 'Content-Transfer-Encoding' ].map(field =>
                    field + ": " + envelope[field.toLocaleLowerCase()] || msg.headers[field.toLocaleLowerCase()] + "\n"
                ).join('')

                sendmail.send({
                    envelope,
                    raw: headers + "\n\n" + body
                })
            }
            //_connection.addFlags(msg.attributes.uid, valid ? [ '\\Deleted', '\\Seen' ] : [ '\\Seen' ])    
        }
    });
}

function start() {
    imap_simple.connect({
        imap: conf.imap,
        onmail: handleMails,
    }).then(connection => {
        _connection = connection;
        connection.on("close", err => {
            console.log("disconnected, reconnecting...");
            start();
        });
        connection.openBox('INBOX');
    }).catch(err => {
        console.error(err);
        console.error("error connecting to imap server, exiting.");
        process.exit(1);
    });
}

module.exports = function (on_modify_password_link) {
    _on_modify_password_link = on_modify_password_link;
    start();
}


