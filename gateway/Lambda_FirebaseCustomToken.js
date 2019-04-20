const AWS = require('aws-sdk');
AWS.config.update({region: process.env['REGION']});
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

const admin = require('firebase-admin');

const serviceAccount = require('serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function setResponse(status, body){
    let response = {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
      
    return response;
}

function getUsername(token) {
    let params = {
        AccessToken: token
      };
    return new Promise((resolve, reject) => {
        cognitoidentityserviceprovider.getUser(params, function(err, data) {
            if (err) {
                console.log(err); // an error occurred
                return reject(err);
            }
            else {
                console.log(data); // successful response
                return resolve(data.Username);
            }    
        });
    });
}

function createCustomToken(name) {
    return admin.auth().createCustomToken(name);
}

exports.handler = async function(event, context, callback) {
    try {
        const username = await getUsername(event['headers']['Authorization']);//[0]['AccessToken']);

        const newToken = await createCustomToken(username);
    
        console.log('results, ' +  JSON.stringify(newToken));

        callback(null, setResponse(200, JSON.stringify(newToken)));
    }
    catch(err) {
        callback(null, setResponse(500, JSON.stringify({"message": err})));
    }
};