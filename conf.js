module.exports = {
    common_password_part: 'xx',

    in_progress_ttl_minutes: 30,

    fcm_base_url: 'https://universite-paris1.hellofcm.com/',

    uid2eppn: uid => `${uid}@univ-paris1.fr`,

    imap: {
        host: 'imap', 
        user: 'foo', password: 'xx',
        //port: 993, tls: true,
    },

    http_server: {
        port: 8080,
    },
};