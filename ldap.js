const ldapjs = require('ldapjs');
const conf = require('./conf');

const searchOne = (base, options) => (
    new Promise((resolve, reject) => {
        const client = ldapjs.createClient({ url: conf.ldap.url });
        
        client.bind(conf.ldap.dn, conf.ldap.password, function (err) {
            if (err) { reject(err); return }

            client.search(base, { scope: 'one', ... options }, function(err, res) {
                if (err) { reject(err); return }
        
                res.on('searchEntry', function(entry) {
                    //console.log(entry.object);
                    resolve(entry.object);
                });
                res.on('error', console.error);
                res.on('end', function(result) {
                    reject("not found");
                    client.destroy();
                });
            });
        });
    })
)

module.exports = { searchOne }
