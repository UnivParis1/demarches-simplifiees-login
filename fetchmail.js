const imap_simple = require('imap-simple');
const quotedPrintable = require('quoted-printable');
const conf = require('./conf');

let _on_modify_password_link;
let _connection;
function handleMails() {
    _connection.search(['UNSEEN'], { bodies: ['TEXT'] }).then(msgs => {
        //console.log(msgs.length + " new messages");
        msgs.forEach(msg => {
            if (msg.parts.length !== 1) {
                console.error("weird mail", msg.attributes.date);
            } else {
                const body = quotedPrintable.decode(msg.parts[0].body);
                const m_url = body.match(/<a href="(.*)">Modifier mon mot de passe</);
                if (m_url) {
                    _on_modify_password_link(m_url[1]);
                } else {
                    console.error("weird mail", msg.attributes.date);
                }
            }
            //_connection.addFlags(msg.attributes.uid, [ '\\Deleted', '\\Seen' ]);
        });
    });
}

function start() {
    imap_simple.connect({
        imap: conf.imap,
        onmail: handleMails,
    }).then(connection => {
        _connection = connection;
        connection.openBox('INBOX');
    });
}

module.exports = function (on_modify_password_link) {
    _on_modify_password_link = on_modify_password_link;
    start();
}


