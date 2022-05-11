const express = require('express');
const router = express.Router();
const DB = require('./tools/config').connection;
const time = require('./tools/utility');
const urlEncodedParser = require('./tools/config').middleware;
const equality = require('./tools/utility').equality;

//view shipments
router.post("/viewShipments", (req, res) => {
    let shipmentTable ="";
    let value = "";
    let shipmentsSQL = "SELECT ship.*,ord.orderID, shipDet.description, shipDet.height, shipDet.length, shipDet.weight, shipDet.width,\n";
    shipmentsSQL += "shipDel.deliveryDate, shipDel.deliveryStatus, shipDel.assignedEmployee, shipUp.updatedBy, shipUp.lastUpdate\n";
    shipmentsSQL += ", IF(res.assignedShipment = ship.shipmentID,(SELECT shelfID FROM shelfreservation WHERE assignedShipment = ship.shipmentID),\"NEW\") AS place\n";
    shipmentsSQL += "FROM shipment ship\n INNER JOIN shipmentdetails shipDet\n INNER JOIN shipmentdelivery shipDel\n INNER JOIN shipmentupdate shipUp\n";
    shipmentsSQL += "INNER JOIN ordershipment ord\n ON ship.shipmentID = shipDet.shipmentID\n AND ship.shipmentID = shipDel.shipmentID\n AND ship.shipmentID = shipUp.shipmentID\n";
    shipmentsSQL += "AND ship.shipmentID = ord.shipmentID\n AND (shipDel.deliveryStatus ='PICKUP' OR shipDel.deliveryStatus ='TOBESTORED')\n AND shipDel.currentEmployee = "+req.body.employeeID+"\n";
    shipmentsSQL += "LEFT JOIN shelfreservation res\n ON res.assignedShipment = ship.shipmentID\n";
    for (const i in req.body.filteredBy){
        if((!(Object.keys(req.body.filteredBy[i]).length===0 && Object.getPrototypeOf(req.body.filteredBy[i]) === Object.prototype) && req.query.filteredBy[i]==""))
            if(typeof req.body.filteredBy[i] === "string")
                shipmentsSQL += " AND ship."+i+" = '"+req.body.filteredBy[i] + "' \n";
            else shipmentsSQL += " AND ship."+i+" = "+req.body.filteredBy[i] + "\n ";
        if(i=="details") 
        shipmentTable = "shipDet";
        else if(i == "updates")
        shipmentTable = "shipUp";
        else if(i == "delivery") 
        shipmentTable = "shipDel";
        else if(i=="order")
        shipmentTable = "ord";
        if(typeof req.body.filteredBy[i] === "object" && (!(Object.keys(req.body.filteredBy[i]).length===0 && Object.getPrototypeOf(req.body.filteredBy[i]) === Object.prototype)))
        for(const j in req.body.filteredBy[i]){
            value = equality(req.body.filteredBy[i],j)
            shipmentsSQL += " AND "+shipmentTable+"."+j+" "+ value + "\n ";
        }
    }
    DB.query(shipmentsSQL, (err,result)=>{
        if (err) throw err;        
        res.send(result); 
    });
});

//view shelfs
router.get("/viewShelfs", (req, res) => {
    let shelfsSQL = "SELECT sh.*, addr.floor,addr.lane,addr.section,addr.row, addr.shelfNumber, upd.updatedBy, upd.lastUpdate , res.assignedShipment\n";
    shelfsSQL += "FROM shelf sh\n INNER JOIN shelfreservation res\n INNER JOIN workerShelf wosh\n INNER JOIN shelfaddress addr\n INNER JOIN shelfupdate upd\n INNER JOIN warehousemember WO";
    shelfsSQL += "\n ON sh.shelfID = res.shelfID\n AND sh.shelfID = upd.shelfID\n AND sh.shelfID = wosh.shelfID\n AND sh.shelfID = addr.shelfID\n";
    shelfsSQL += "AND WO.warehouseID = addr.warehouseID\n AND WO.memberID = wosh.workerID\n AND WO.memberID = "+req.query.employeeID+";\n";
    DB.query(shelfsSQL, (err,result)=>{
        if (err) throw err;        
        res.send(result); 
    });
});

//move shipments
router.post("/moveShipments",urlEncodedParser, (req, res) => {
    let stat = "";
    let checkDestinationSQL = "";
    let deliverySQL = "";
    let emp = "";
    let reservation = "";
    let shelf = "";
    for(const i in req.body.shelfs){
        checkDestinationSQL = "SELECT deliveryStatus FROM shipmentdelivery\n WHERE currentEmployee = "+req.body.employeeID + "\n AND shipmentID =" + req.body.shelfs[i].shipmentID + "\n";
        DB.query(checkDestinationSQL, (err,result)=>{
            if (err) throw err;
            if(result!=""){
                stat = result[0].deliveryStatus
                if (stat=='TOBESTORED'){
                    stat = 'STORED';
                    emp = "currentEmployee = null,";
                    shelf = req.body.shelfs[i].shelfID;
                    reservation = "UPDATE shelfreservation\n SET assignedShipment =" + req.body.shelfs[i].shipmentID +" WHERE shelfID = "+shelf+";\n";
                }
                else if (stat=='PICKUP'){
                    stat = 'PICKEDUP'
                    emp = "currentEmployee = (SELECT memberID FROM warehousemember WM INNER JOIN employee EM ON EM.role = 'WM' AND EM.employeeID = WM.memberID AND WM.warehouseID = (SELECT warehouseID FROM warehousemember WHERE memberID = "+req.body.employeeID+")),";
                    shelf = "(SELECT shelfID FROM shelfreservation WHERE assignedShipment = "+req.body.shelfs[i].shipmentID+")";
                    reservation = "UPDATE shelfreservation res1\n INNER JOIN shelfreservation res2\n  ON res2.assignedShipment = "+req.body.shelfs[i].shipmentID+"\n SET res1.assignedShipment = null\n WHERE res2.shelfID = res1.shelfID; \n";
                } 
                else stat = 'UNKNOWN'; 
                deliverySQL = "START TRANSACTION; \n"; 
                deliverySQL += "UPDATE shipmentdelivery\n SET "+emp+" deliveryStatus = '"+stat+"' WHERE shipmentID = "+req.body.shelfs[i].shipmentID+"; \n";
                deliverySQL += "UPDATE shipmentupdate\n SET updatedBy = " + req.body.employeeID + ", lastUpdate = '"+ time.getDateTime() +"'\n WHERE shipmentID = " + req.body.shelfs[i].shipmentID+"; \n";
                deliverySQL += "UPDATE shelfupdate\n SET updatedBy = "+ req.body.employeeID + ", lastUpdate = '"+ time.getDateTime()+"' WHERE shelfID = "+shelf+";\n";
                deliverySQL += reservation;
                deliverySQL += "INSERT INTO shipmentrecord(shipmentID, recordedPlace, recordedTime, userAction, actor)\n VALUES("+req.body.shelfs[i].shipmentID+", (SELECT currentCity FROM shipmentdelivery WHERE shipmentID = "+req.body.shelfs[i].shipmentID+"), '"+time.getDateTime()+"' ,'UPDATE', " + req.body.employeeID + "); \n";
                deliverySQL += "COMMIT; ";
                console.log(deliverySQL);
                DB.query(deliverySQL, (err)=>{
                    if (err) throw err;   
                }); 
            }
        });
    }
    res.send({
        "status": "SUCCESS", 
        "err": false
    });
});


module.exports = router;