const AWS = require('aws-sdk');
AWS.config.update({region: process.env['REGION']});
const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

const admin = require('firebase-admin');

const serviceAccount = require('serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function setResponse(status, body){
    return {
        headers: {
            'Content-Type': 'application/json'},
        body: body,
        statusCode: status
    };
}

function getUser(token) {
    const params = {
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
                return resolve(data.UserAttributes.find(attr => attr.Name === 'sub').Value);
            }    
        });
    });
}

/**
 * Generates firebase token using firebase-admin sdk
 * @param {string} userId - user identifier from cognito (sub attribute)
 */
function createCustomToken(userId) {
    return admin.auth().createCustomToken(userId);
}

exports.handler = async (event, context, callback) => {
    try {
        const userId = await getUser(event['headers']['Authorization']);//[0]['AccessToken']);

        const newToken = await createCustomToken(userId);
    
        console.log('results, ' +  JSON.stringify(newToken));

        callback(null, setResponse(200, JSON.stringify(newToken)));
    }
    catch(err) {
        callback(null, setResponse(500, JSON.stringify({"message": err})));
    }
};