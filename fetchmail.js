const imap_simple = require('imap-simple');
const quotedPrintable = require('quoted-printable');
const conf = require('./conf');

let _on_modify_password_link;
let _connection;
function handleMails() {
    _connection.search(['UNSEEN'], { bodies: ['TEXT'] }).then(msgs => {
        if (msgs.length > 0) console.log(msgs.length + " new messages");
        msgs.forEach(msg => {
            let valid = false;
            if (msg.parts.length !== 1) {
                console.error("weird mail", msg.attributes.date);
            } else {
                const body = quotedPrintable.decode(msg.parts[0].body);
                const m_eppn = body.match(/Bonjour (.*?@.*?),/);
                const m_url = body.match(/<a href="(.*?)">Modifier mon mot de passe</);
                if (m_eppn && m_url) {
                    valid = true;
                    _on_modify_password_link(m_eppn[1], m_url[1]);
                }
            }
            if (!valid) console.error("weird mail", msg.attributes.date);
            _connection.addFlags(msg.attributes.uid, valid ? [ '\\Deleted', '\\Seen' ] : [ '\\Seen' ]);
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


