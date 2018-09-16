//'use strict';
function help1() {
    //return new Promise((resolve,reject) => setTimeout(() => {resolve("help1")}, 2000));
    return "help1";
    // setTimeout(() => {
    //    return "help1"; 
    // }, 1000);
}

function help2() {
    return "help2"
}

function getUTC() {
    const date = new Date();
    let result = date.getUTCFullYear() + "-";
    result = result.concat(date.getUTCMonth() + "-");
    result = result.concat(date.getUTCDate() + " ");
    
    result = result.concat(date.getUTCHours() + ":");
    result = result.concat(date.getUTCMinutes() + ":");
    result = result.concat(date.getUTCSeconds() + " UTC");

    return result;
}

function dateToString() {
    const date = new Date();
    var day = date.getUTCDate();
    var month = date.getUTCMonth() + 1;
    var year = date.getUTCFullYear();

    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const seconds = date.getUTCSeconds();

    return '' + year + '-' + (month <= 9 ? '0' + month : month) + '-' + (day <= 9 ? '0' + day : day)
            + ' ' + (hours <= 9 ? '0' + hours : hours) + ':' + (minutes <= 9 ? '0' + minutes : minutes)
            + ':' + (seconds <= 9 ? '0' + seconds : seconds);
}

async function func() {
    let list = [];
    list.push({
        PutRequest: {
            Item: {
                "Key": {
                    "fileName": {"S": "value1"}
                },
                "createdAt": {"S": "date1"},
                "id" : {"S": "id1"}
            }
        }
    });
    list.push({
        PutRequest: {
            Item: {
                "Key": {
                    "fileName": {"S": "value2"}
                },
                "createdAt": {"S": "date2"},
                "id" : {"S": "id2"}
            }
        }
    });
    console.log('list\n' + JSON.stringify(list));
    console.log('length = ' + list.length);
    //console.log(dateToYMD());
    // const str1 = await help1();
    // //help1().then(value => {console.log(value)});
    // const str2 = help2();

    // console.log("help1 = " + str1);
    // console.log("help2 = " + str2);
}

func();

