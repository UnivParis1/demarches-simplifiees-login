const fs = require('fs')
const imap_simple = require('imap-simple');
const conf = require('./conf');

/** @typedef {{attributes: { date: Date, uid: string }, headers: Object<string, string[]>, html: string}} Mail */

/** @type {(msg: Mail) => boolean} */
let _on_mail;


let _connection;
function handleMails() {
    _connection.search(['UNSEEN'], { bodies: ['HEADER'], struct: true }).then(msgs => {
        if (msgs.length > 0) console.log("fetchmail:", msgs.length, " new messages");
        for (const raw_msg of msgs) {
            const parts = imap_simple.getParts(raw_msg.attributes.struct);
            const htmlPart = parts.find(part => part.subtype === 'html')
            _connection.getPartData(raw_msg, htmlPart).then(html => {
                /** @type Mail */
                const msg = {
                    attributes: raw_msg.attributes,
                    headers: raw_msg.parts.find(p => p.which === 'HEADER')?.body,
                    html,
                }
                let valid = false
                if (!msg.headers || !msg.html) {
                    console.error("weird mail", msg.attributes.date);
                } else {
                    valid = _on_mail(msg)
                }
                _connection.addFlags(msg.attributes.uid, valid ? [ '\\Deleted', '\\Seen' ] : [ '\\Seen' ])    
            })
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

/**
 * @param {(msg: Mail) => boolean} on_mail 
 */
module.exports = function (on_mail) {
    _on_mail = on_mail;
    start();
}
