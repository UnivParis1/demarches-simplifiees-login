const url = require('url');
const rpn = require('request-promise-native');
const crypto = require('crypto');

exports.sha256 = function (data) {
    const hash = crypto.createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
};

exports.new_navigation = function(request_options) {
    const rp = rpn.defaults({
        headers: { 'User-Agent': 'Mozilla/123.0 (xxx; rv:123.0) Gecko/20100101 Firefox/123.0' },
        jar: rpn.jar(),
        ...(request_options || {}),
    });
    let prev_url;
    return {
        submit(form$, params) {
            prev_url = url.resolve(prev_url, form$.attr('action'));
            //console.log("submitting form", prev_url, form$.serializeArray())
            return rp({ 
                method: 'POST',
                url: prev_url,
                body: form$.serialize(),
                ...params,
            })        
        },
        request(params) {
            prev_url = params.url;
            return rp(params);
        }
    }
};

