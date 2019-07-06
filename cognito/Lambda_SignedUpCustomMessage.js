const AWS = require('aws-sdk');

AWS.config.update({region: process.env['REGION']});
const docClient = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();


function getLastAppVersionFileName() {
    const params = {
        Limit: 1,
        TableName: process.env['RECIPE_TABLE'],
        KeyConditionExpression: "partitionKey = :v_key",
        ExpressionAttributeValues: {
            ":v_key": process.env['APP_PARTITION']
        },
        ScanIndexForward: false,
        ReturnConsumedCapacity: "TOTAL"
    };

    return new Promise((resolve, reject) => {
        docClient.query(params, (err, data) => {
            if (err) {
                console.error("Unable to query the table. Error JSON:", JSON.stringify(err, null, 2));
                return reject(err);
            } else {
                // print all the data
                console.log("Query succeeded. ", JSON.stringify(data));
                if(data.Count === 0 || data.Items.length === 0) {
                    return reject({
                        statusCode: 404, // Not Found
                        message: "app not found"
                    });
                }
                return resolve(data.Items[0].name);
            }
        });
    });
}

function signUrl(fileName) {
    const myBucket = process.env['BUCKET'];
    const filePath = process.env['APP_FOLDER'] + "/" + fileName;
    const signedUrlExpireSeconds = eval(process.env['AVAILABLE_TIME_NUMBER']); //60 * 60 * 24; // 24 hours

    const params = {
        Bucket: myBucket,
        'Key': filePath,
        Expires: signedUrlExpireSeconds
    };

    return s3.getSignedUrl('getObject', params);
}


exports.handler = async (event, context, callback) => {
    console.log(JSON.stringify(event));
    
    if(event.triggerSource === "CustomMessage_AdminCreateUser") {
            // Ensure that your message contains event.request.codeParameter event.request.usernameParameter. This is the placeholder for the code and username that will be sent to your user.
            event.response.smsMessage = `Welcome to the app.<br/> Your user name is ${event.request.usernameParameter} and your temporary password is ${event.request.codeParameter}.`;
            event.response.emailSubject = "Welcome to FamilyRecipes app";
            event.response.emailMessage = `<body dir=ltr>Welcome to the service.<br/> Your user name is <strong>${event.request.usernameParameter}</strong> and your temporary password is <strong>${event.request.codeParameter}</strong>.`;
            
            try {
                const fileName = await getLastAppVersionFileName();
                event.response.emailMessage += `<br/><br/>Here is a download <a href=\"${signUrl(fileName)}\">link</a> available for 
                ${process.env['AVAILABLE_TIME_STRING']} <br/><br/>Welcome!<br/>@ronginat</body>`;
            } catch (err) {
                console.log('err', JSON.stringify(err));
                event.response.emailMessage += "</body>";
            }
    }
    
    callback(null, event);
};