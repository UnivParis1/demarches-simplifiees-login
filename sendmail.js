const nodemailer = require('nodemailer')
const conf = require('./conf')

const mailTransporter = nodemailer.createTransport(conf.sendmail.transport);

// sendMail does not return a promise, it will be done in background. We simply log errors
// params example:
// { from: 'xxx <xxx@xxx>', to: 'foo@bar, xxx@boo', subject: 'xxx', text: '...', html: '...' }
const send = (params) => {
    if (!params.envelope) {
        params = { from: conf.sendmail.from, ... params };
    }
    if (conf.sendmail.intercept) {
        const cc = (params.cc || '').toString();
        if (params.subject) {
            params.subject = '[would be sent to ' + params.to + (cc ? " Cc " + cc : '') + '] ' + params.subject;
        }
        if (params.envelope?.to) {
            params.envelope.to = conf.sendmail.intercept;
        } else {
            params.to = conf.sendmail.intercept;            
        }
        delete params.cc;
    }
    mailTransporter.sendMail(params, (error, info) => {
        if (error) {
            console.log(error);
        } else {
            console.log('Mail sent: ', info);
        }
    });
};

module.exports = { send }