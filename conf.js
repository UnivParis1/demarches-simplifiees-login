const sendmailTransport = require('nodemailer-sendmail-transport')

module.exports = {
    common_password_part: 'xx',

    in_progress_ttl_minutes: 30,

    ds_base_url: 'https://demarches.adullact.org/',
    our_proxy_base_url: 'https://demarches.univ-paris1.fr/',

    imap: {
        host: 'imap', 
        user: 'foo', password: 'xx',
        //port: 993, tls: true,
    },

    sendmail: {
        from: 'DSIUN Université Paris 1 Panthéon-Sorbonne <no-reply@univ-paris1.fr>',
        intercept: '', //'Admin <admin@univ.fr>',
        transport: sendmailTransport({ path: '/usr/sbin/sendmail' }), // give sendmail with full path (since PATH may not have /usr/sbin/)
    },

    ldap: {
        url: 'ldap://ldap',
        dn: 'cn=fcm-login,ou=admin,dc=univ,dc=fr',
        password: '',
        people_base: '',
    },

    http_server: {
        port: 8080,
    },
};