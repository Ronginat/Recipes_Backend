const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});

const docClient = new AWS.DynamoDB.DocumentClient();

function dateToString() {
    return new Date().toISOString();
}

function createUser(user_name, user_email) {
    const date = dateToString();
    const params = {
        TableName: process.env['USERS_TABLE'],
        Item: {
            //hash: process.env['APP_NAME'], //Recipes
            id: user_name,
            username: user_name,
            confirmed: false,
            email: user_email,
            creationDate: date,
            favorites: {},
            posted: []
        },
        ConditionExpression: "attribute_not_exists(confirmed)",
        ReturnValues: "NONE"
    };

    return new Promise((resolve, reject) => {
        docClient.put(params, (err, data) => {
            if(err) {
                console.log("Error user PUT, " + JSON.stringify(err));
                reject(err);
            } else {
                console.log("Success user PUT, " + JSON.stringify(data));
                resolve(data);
            }
        });
    });
}

exports.handler = async (event, context, callback) => {
    console.log(JSON.stringify(event));
    try {
        if(event.triggerSource === "PreSignUp_AdminCreateUser") {
             await createUser(event.userName, event.request.userAttributes.email);
        callback(null, event);
        } else
            throw "You cannot create users!";
    } catch(err) {
        console.log("CATCH, " + JSON.stringify(err));
    }
};