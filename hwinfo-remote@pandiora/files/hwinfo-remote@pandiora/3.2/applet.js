const uuid          = imports.applet.uuid;
const AppletDir     = imports.ui.appletManager.applets[uuid];
const Settings      = imports.ui.settings;
const Applet        = imports.ui.applet;
const PopupMenu     = imports.ui.popupMenu;
const Main          = imports.ui.main;

const St            = imports.gi.St;
const Soup          = imports.gi.Soup;
const Pango         = imports.gi.Pango;
const PangoCairo    = imports.gi.PangoCairo;

const Mainloop      = imports.mainloop;
const Lang          = imports.lang;
const Util          = imports.misc.util;
const GLib          = imports.gi.GLib;
const Cairo         = imports.cairo;

const _             = imports.applet._;
const _httpSession  = new Soup.SessionAsync();
// ===========================================================

var data = {
    "CPU": [],
    "GPU": [],
    "BRD": []
}, rgba = {
    "CPU": [0, 0.50, 1, 1],
    "GPU": [0.25, 1, 0, 1],
    "BRD": [1, 0, 0, 1],
    "TXT": [1, 1, 1, 0.7]
}, KEYS = [
    'update-interval',
    'host-type',
    'host-name',
    'host-url',
    'host-user',
    'host-password',
    'cpu-color',
    'gpu-color',
    'brd-color',
    'txt-color',
    'show-elements',
    'icon-padding-x',
    'icon-padding-y',
    'line-width',
    'temperature-unit',
    'cpu-shortname',
    'cpu-shortword',
    'gpu-shortname',
    'gpu-shortword',
    'brd-shortname',
    'brd-shortword',
    'host-mac',
    'wol-package',
    'wake-text',
    'wake-icon',
    'wake-command',
    'reboot-text',
    'reboot-icon',
    'reboot-command',
    'shutdown-text',
    'shutdown-icon',
    'shutdown-command'
], remote = [
    'wake',
    'reboot',
    'shutdown'
];




function MyApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}
MyApplet.prototype = {
    __proto__:  Applet.Applet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.Applet.prototype._init.call(this, orientation, panel_height, instance_id);

        try {

            // there's a problem getting the orientation out of _init-scope    
            this.orientation = orientation;
            this.on_orientation_changed(orientation);

            // Settings
            this.settings = new Settings.AppletSettings(this, uuid, instance_id);
            for (let k in KEYS) {
                let arr = KEYS[k].split("-"); // remove "-" from String
                let prop = arr[0]+arr[1].charAt(0).toUpperCase()+arr[1].slice(1); // first letter uppercase for 2nd group
                    prop += (arr.length===3) ? arr[2].charAt(0).toUpperCase()+arr[2].slice(1) : ""; // same for 3rd group
                
                this.settings.bindProperty(Settings.BindingDirection.IN, KEYS[k], prop, this.on_settings_changed, null);
            }

            // We need to parse and update the colors, since we only get a string like 
            // "rgba(255,128,0,1)" and cinnamon uses rgba-values from 0 to 1
            this.rgbaSettingsUpdate();

            // Prepare GraphArea
            this.graphArea = new St.DrawingArea();
            this.graphArea.height = panel_height;
            this.graphArea.width = this.calculateGraphArea(panel_height, 0);
            this.graphArea.connect('repaint', Lang.bind(this, this.onGraphRepaint));

            // Fill Arrays with Zeros based on width
            this.fillArrayZero((this.calculateGraphArea(this.graphArea.height, 1)-this.calculateTotalPaddingX(this.showElements, this.iconPaddingX)));

            // Objects/Arrays we need to work with
            this.updateSettingsArray();

            // Build Menu
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.buildMenu();

            // Finish Init and start painting
            this.actor.add_actor(this.graphArea);
            this.allGraph = new Graph(this.graphArea, this.settingsArr);
            this._update();
        }
        catch (e) {
            global.logError(e);
        }

    },

    buildMenu: function(){

        // update menu everytime
        if(this.menu) this.menu.destroy();

        // Create the popup menu
        this.menu = new Applet.AppletPopupMenu(this, this.orientation);
        this.menuManager.addMenu(this.menu);

        // Add Sub-Menu
        let remoteSubmenu = new PopupMenu.PopupSubMenuMenuItem(this.hostName);
        this.menu.addMenuItem(remoteSubmenu);

        // Set up needed data for commands
        let eth = "pkexec sudo etherwake -i `ip -4 route ls | grep default | grep -Po '(?<=dev )(\S+)'` ",
            log = this.hostUser + "%" + this.hostPassword,
            typ = this.hostType, mac = this.hostMac,
            wpa = this.wolPackage, cmd = "test",
            eip = this.hostUrl.split(":")[0];

        // Create Submenu-Entries
        for(let i=0, len = remote.length; i<len; i++){

            let txt = remote[i], menuItem = new PopupMenu.PopupIconMenuItem(_(this[txt+"Text"]), this[txt+"Icon"], St.IconType.SYMBOLIC);
            remoteSubmenu.menu.addMenuItem(menuItem);

            menuItem.connect("activate", Lang.bind(this, function(){
                // ToDo: clean this up and add check for [prop]Text is set, so we can add more submenu-Entries
                if(typ === "Windows"){
                    if((txt === "wake") && (wpa === "wakeonlan")){
                        if(this.wakeCommand !== ""){ cmd = this.wakeCommand; } 
                        else { cmd = ((mac === "") || (mac === "00:00:00:00:00:00")) ? Main.notify("Mac is not set") : "wakeonlan "+mac; }
                    } else if((txt === "wake") && (wpa === "wol")){
                        if(this.wakeCommand !== ""){ cmd = this.wakeCommand; } 
                        else { cmd = ((mac === "") || (mac === "00:00:00:00:00:00")) ? Main.notify("Mac is not set") : "wol "+mac; }
                    } else if((txt === "wake") && (wpa === "etherwake")){
                        if(this.wakeCommand !== ""){ cmd = this.wakeCommand; } 
                        else { cmd = ((mac === "") || (mac === "00:00:00:00:00:00")) ? Main.notify("Mac is not set") : eth+mac }
                    } else if( txt === "reboot"){
                        if(this.rebootCommand !== ""){ cmd = this.rebootCommand; } 
                        else { cmd = ((log == "%") || (eip === "")) ? Main.notify("Login-Credentials or Host-URL not set") : "pkexec sudo net rpc shutdown -r -t 0 -C 'Reboot requested by Remote-User' -U "+log+" -I "+eip; }
                    } else if( txt === "shutdown"){
                        if(this.shutdownCommand !== ""){ cmd = this.shutdownCommand; } 
                        else { cmd = ((log == "%") || (eip === "")) ? Main.notify("Login-Credentials or Host-URL not set") : "pkexec sudo net rpc shutdown -f -t 0 -C 'Shutdown requested by Remote-User' -U "+log+" -I "+eip; }
                    }
                } else if(typ === "Linux"){
                    // ToDo: Implement commands for Linux
                } else {
                    global.logError("No OS-Type was set, something went horribly wrong.");
                }

                // Execute constructed or custom command - parse first
                let [success, argv] = GLib.shell_parse_argv(cmd);
                if(!success){
                    Main.notify("Unable to parse \"" + cmd + "\"");
                    return;
                }

                let flags = GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD;
                let [result, pid] = GLib.spawn_async(null, argv, null, flags, null);
                //if(result){ Main.notify("Command executed succesfully: "+result); }
                //global.logError(typ + " : " + cmd + ":" + txt);
            }));
        }        
    },

    on_applet_clicked: function(event){
        this.menu.toggle();
    },

    on_orientation_changed: function(orientation) {
        // ToDo: add some logic
        this.orientation = orientation;
        if (orientation == St.Side.LEFT || orientation == St.Side.RIGHT) {
            // insert something
        }
        else {
            // insert something
        }
    },    

    calculateGraphArea: function(height, mode){

        // Calculate width by height - Aspect-Ratio 1:2 mostly
        let width = 0, divisor = 0;

        switch(this.showElements) {
            case 1:     width = (height*2)*2;   divisor=2;   break; // Text and Graph
            case 2:     width = height*2;       divisor=1;   break; // Text only
            case 3:     width = height*2;       divisor=1;   break; // Graph only
            case 4:     width = height*2;       divisor=2;   break; // Small Text and Graph
            case 5:     width = height;         divisor=1;   break; // Small Text only
            case 6:     width = height;         divisor=1;   break; // Small Graph only
            case 9:     width = height/3;       divisor=1;   break; // Minimal Graph only
        }

        // We need a separate division when this function is called to
        // calculate the width of graphs and for filling data-arrays
        width = (mode == 1) ? (width/divisor) : width;
        // aaaand sometimes we get uneven numbers -> round them
        width = Math.round(width);

        return width;
    },

    calculateTotalPaddingX: function(ele, padding){

        let pad = 0;

        switch(this.showElements) {
            case 1:     pad = padding*2;   break; // Text and Graph
            case 3:     pad = padding*1;   break; // Graph only
            case 4:     pad = padding*2;   break; // Small Text and Graph
            case 6:     pad = padding*1;   break; // Small Graph only
            case 9:     pad = padding*1;   break; // Minimal Graph only
        }

        // aaaaand sometimes we get shitty numbers here too -> round em
        pad = Math.round(pad);

        return pad;
    },

    on_settings_changed: function(){
        this.rgbaSettingsUpdate();
        this.updateSettingsArray();
        this.buildMenu();
        this.graphArea.width = this.calculateGraphArea(this.graphArea.height, 0);
        this.recalculateDataArray();
    },

    updateSettingsArray: function(){
        // for use in Graph Prototype
        this.settingsArr = {
            "height": this.graphArea.height,
            "width": this.graphArea.width,
            "iconPaddingX": this.iconPaddingX,
            "iconPaddingY": this.iconPaddingY,
            "lineWidth": this.lineWidth,
            "showElements": this.showElements,
            "temperatureUnit": this.temperatureUnit,
            "cpuShortname": this.cpuShortname,
            "cpuShortword": this.cpuShortword,
            "gpuShortname": this.gpuShortname,
            "gpuShortword": this.gpuShortword,
            "brdShortname": this.brdShortname,
            "brdShortword": this.brdShortword
        };
    },

    onGraphRepaint: function(area) {
        try {
            this.allGraph.paint(area, this.settingsArr);
        }catch(e)
        {
            global.logError(e);
        }
    },

    _update: function(){
        this.refreshJSON();
        this.graphArea.queue_repaint();

        Mainloop.timeout_add(this.updateInterval, Lang.bind(this, this._update));
    },

    loadJsonAsync: function(url, callback) {
        let context = this;
        let message = Soup.Message.new('GET', url);
        _httpSession.queue_message(message, function soupQueue(session, message) {
                callback.call(context, JSON.parse(message.response_body.data));
        });
    },

    refreshJSON: function(){
        this.loadJsonAsync(("http://"+this.hostUrl), function(json) {

            if (!json) {
                // we can't get any data, display na
                for(let prop in data){
                    data[prop].shift();
                    data[prop].push("na"); 
                }     
            } else {

                for(let prop in data){
                    for (let i=0, iLen=json.length; i<iLen; i++) {
                        if(json[i]["SensorApp"] === "HWiNFO"){

                            if(json[i]["SensorName"] === this[prop.toLowerCase()+"Shortword"]) {
                                data[prop].shift();
                                // to avoid rounding problems just remove decimals and ,|.
                                data[prop].push(json[i]["SensorValue"].split(/,|\./)[0]);
                                // value added to array, stop here
                                break;
                            }
                            // couldn't find matching value, add 0
                            if((i+1) === iLen){
                                data[prop].shift();
                                data[prop].push("na");
                            }
                        }
                    }
                }
            }
        });
    },

    objPropToArray: function(object){
        let arr = [];
        for(let prop in object){
            arr.push(prop);
        }

        return arr;
    },

    fillArrayZero: function(len){
        // Replace all Arrays in data-object with filled array

        for(var prop in data){
            // Array must be generated here to avoid duplication
            let arr = Array.apply(null, Array(len)).map(Number.prototype.valueOf,0);
            data[prop] = arr;
        }

    },

    recalculateDataArray: function(){

        let newLength = this.calculateGraphArea(this.graphArea.height, 1)-this.calculateTotalPaddingX(this.showElements, this.iconPaddingX);
        let oldLength = data["CPU"].length;

        //global.logError("New: "+newLength+" Old: "+oldLength+" Arr: "+data["CPU"])

        if(newLength > oldLength){
            // add values to the beginning of data-arrays
            for(let prop in data){
                // Array must be generated here to avoid duplication
                let arr = Array.apply(null, Array(newLength-oldLength)).map(Number.prototype.valueOf,0);
                data[prop].unshift.apply(data[prop], arr);
            }

        } else if(newLength < oldLength){
            // Remove values from data-arrays
            for(let prop in data){
                for(let i=0, cnt = oldLength-newLength;i < cnt;i++){
                    data[prop].shift();
                }
            }
        }

    },

    rgbaSettingsUpdate: function(){
        for(let prop in rgba){
            this.rgbaToOneScale(prop, this[prop.toLowerCase()+"Color"]);
        }
    },

    rgbaToOneScale: function(provider, str){

        // extract numbers from string
        let rgbaa = str.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+(?:[,.]\d+)?))?/);
        let calc_rgba = 0;

        // If we only get an rgb-string alpha must be set to 1
        if (rgbaa[4] === undefined) rgbaa[4] = "1";

        // Only calculate RGB-Values here - use exponents for better rounding
        for(let i=1; i<4; i++) {
            calc_rgba = Number(Math.round((rgbaa[i]/255)+'e2')+'e-2');
            rgba[provider][i-1] = calc_rgba;
        }

        // Calc alpha here (A) - use exponents for better rounding
        calc_rgba = Number(Math.round(rgbaa[4].replace(",",".")+'e2')+'e-2');
        rgba[provider][3] = calc_rgba;

    }

};



function Graph(area, sArr) {
    this._init(area, sArr);
}
Graph.prototype = {
    
    _init: function(_area, _sArr) {

    },

    paint: function(area, sArr) {
        this.fontSize = Math.floor((sArr["height"]-(sArr["iconPaddingY"]*2))/3); // divide expected height by 3 for 3 labels
        //ToDo: Set Font-Face to Monospace (DejaVuSansMono) 
        this.fontdesc = Pango.font_description_from_string("Sans Regular "+this.fontSize+"px");

        //global.logError("Width: "+width+" Height: "+height+" Padding: "+padding+" LineWidth: "+lineWidth+" Elements: "+elements)
        let cr = area.get_context();
        let lcount = 0;

        // Paint Labels
        /////////////////////////////////////////////////
        if([1,2,4,5].indexOf(sArr["showElements"]) > -1){
            for(let prop in data){

                let leftpad = 0;

                switch(sArr["showElements"]){
                    case 1: leftpad = sArr["height"]+sArr["iconPaddingX"]; break;
                    case 2: leftpad = sArr["height"]+sArr["iconPaddingX"]; break;
                    case 4: leftpad = sArr["iconPaddingX"]; break;
                    case 5: leftpad = sArr["iconPaddingX"]; break;
                }

                // Init Labels
                let dotlayout = area.create_pango_layout("•");
                let compolayout = area.create_pango_layout(sArr[prop.toLowerCase()+"Shortname"]);
                let valuelayout = area.create_pango_layout(this.buildTemp(prop, sArr["temperatureUnit"]));

                // Define Layout
                cr.setSourceRGBA(rgba["TXT"][0], rgba["TXT"][1], rgba["TXT"][2], rgba["TXT"][3]);
                dotlayout.set_font_description(this.fontdesc);
                compolayout.set_font_description(this.fontdesc);
                valuelayout.set_font_description(this.fontdesc);

                // Create Labels
                if([1,2].indexOf(sArr["showElements"]) > -1){
                    cr.moveTo(sArr["iconPaddingX"], sArr["iconPaddingY"]+(lcount*this.fontSize));
                    PangoCairo.layout_path(cr, compolayout);
                    cr.fill();
                }       
                cr.moveTo(leftpad, sArr["iconPaddingY"]+(lcount*this.fontSize));
                PangoCairo.layout_path(cr, valuelayout);
                cr.fill();

                // Create Dots (legend for colors)
                if(sArr["showElements"] == 1){
                    cr.setSourceRGBA(rgba[prop][0], rgba[prop][1], rgba[prop][2], rgba[prop][3]);
                    cr.moveTo((3*this.fontSize)+(sArr["iconPaddingX"]/2), (sArr["iconPaddingY"]+(lcount*this.fontSize)));
                    PangoCairo.layout_path(cr, dotlayout);
                    cr.fill();
                }

                lcount++;
            }
        }

        // Paint Graphs
        /////////////////////////////////////////////////
        if([1,3,4,6].indexOf(sArr["showElements"]) > -1){

            for(let prop in data){

                let leftpad = 0;

                switch(sArr["showElements"]){
                    case 1: leftpad = (sArr["width"]/2)+(sArr["iconPaddingX"]*2); break;
                    case 3: leftpad = sArr["iconPaddingX"]; break;
                    case 4: leftpad = (sArr["width"]/2)+(sArr["iconPaddingX"]*2); break;
                    case 6: leftpad = sArr["iconPaddingX"]; break;
                }
                cr.setSourceRGBA(rgba[prop][0], rgba[prop][1], rgba[prop][2], rgba[prop][3]);
                cr.setLineWidth(sArr["lineWidth"]);
                cr.moveTo(leftpad, this.calcPixel(sArr["height"], sArr["iconPaddingY"], sArr["lineWidth"], data[prop][0]));

                for (let i = 1, len = data[prop].length; i < len; i++)
                {
                    cr.lineTo(leftpad+i, this.calcPixel(sArr["height"], sArr["iconPaddingY"], sArr["lineWidth"], data[prop][i]));
                }

                cr.stroke();
            }
        }

        // Minimalistic Graph
        /////////////////////////////////////////////////
        if(sArr["showElements"] == 9){

            let width = sArr["width"]-(2*sArr["iconPaddingX"]);
            let height = sArr["height"]-(2*sArr["iconPaddingY"]);
            let datPixel = this.getHighestValue();
            let rgbdat = [];

            // switch colors depending on temp-level
            switch(true){
                case (datPixel <= 40): rgbdat = [0,0.5,0,1]; break;
                case (datPixel <= 65): rgbdat = [1,1,0,1]; break;
                case (datPixel >  65): rgbdat = [1,0,0,1]; break;                
            }

            cr.setSourceRGBA(1, 1, 1, 1);
            cr.setLineWidth(sArr["lineWidth"]);

            cr.moveTo( sArr["iconPaddingX"], sArr["iconPaddingY"]);
            cr.lineTo( sArr["iconPaddingX"]+width, sArr["iconPaddingY"]);
            cr.lineTo( sArr["iconPaddingX"]+width, sArr["iconPaddingY"]+height);
            cr.lineTo( sArr["iconPaddingX"], sArr["iconPaddingY"]+height);
            cr.lineTo( sArr["iconPaddingX"], sArr["iconPaddingY"]);
            cr.stroke();

            cr.setSourceRGBA(rgbdat[0], rgbdat[1], rgbdat[2], rgbdat[3]);
            cr.moveTo( sArr["iconPaddingX"]+1, this.calcPixel(sArr["height"], sArr["iconPaddingY"], sArr["lineWidth"], datPixel)+1);
            cr.lineTo( sArr["iconPaddingX"]+width-1, this.calcPixel(sArr["height"], sArr["iconPaddingY"], sArr["lineWidth"], datPixel)+1);
            cr.lineTo( sArr["iconPaddingX"]+width-1, (sArr["height"]-(2*sArr["iconPaddingY"])));
            cr.lineTo( sArr["iconPaddingX"]+1, (sArr["height"]-(2*sArr["iconPaddingY"])));
            cr.lineTo( sArr["iconPaddingX"]+1, this.calcPixel(sArr["height"], sArr["iconPaddingY"], sArr["lineWidth"], datPixel)+1);
            cr.fill();
        }


    },

    calcPixel: function(height, paddingY, lineWidth, provider) {

        // display 0 if the value is na
        provider = (provider == "na") ? 0 : provider;

        // Now respecting paddings YaY \o/
        let padTwo = (paddingY == 0) ? 0 : (paddingY*2);
        let cData = (((height-padTwo)/100)*provider);
        let cLine = (lineWidth >= 1) ? (lineWidth/2) : lineWidth;
        let calc = (Number(Math.round(((height-paddingY)-(cData+cLine))+'e1')+'e-1'));
        //global.logError("height: "+height+" Calc: "+calc);
        return calc;
    },

    buildTemp: function(prop, unit) {
        let temp = data[prop][data[prop].length-1];
        let Unit = "";

        // Use special Characters including Degree+Unit to avoid line-breaks nvm
        switch(unit){
            case "°C": Unit = "℃"; break;
            case "°F": Unit = "℉", temp = Math.round((temp*(9/5))+32); break;
            case  "K": Unit = "K", temp = Math.round(temp-273.15); break;
        }

        let len = temp.toString().length;
        temp = (len < 3) ? Array((3-len)+1).join(" ")+temp+Unit : temp+Unit; // U+2007 for non-breaking space
        return temp;
    },

    getHighestValue: function(){

        let cpuHigh = data["CPU"][data["CPU"].length-1],
            gpuHigh = data["GPU"][data["GPU"].length-1],
            brdHigh = data["BRD"][data["BRD"].length-1],
            arrHigh = [cpuHigh, gpuHigh, brdHigh],
            valHigh = Math.max.apply(Math, arrHigh);

        return valHigh;

    },

    drawRoundedRectangle: function(cr, x, y, width, height, radius)
    {
        if(height > 0)
        {
            var degrees = 3.14159 / 180.0;
            cr.newSubPath();
    
            cr.moveTo( x + radius, y);                      // Move to A
            cr.lineTo( x + width - radius, y);              // Straight line to B
            cr.lineTo( x + width, y + height - radius);     // Move to D
            cr.lineTo( x + radius, y + height);             // Line to F
            cr.lineTo( x, y + radius);                      // Line to H
            
            cr.closePath();
        }
    }

};

function main(metadata, orientation, panel_height, instance_id) {
    return new MyApplet(metadata, orientation, panel_height, instance_id);
}
function spawn_async(args, callback) {
    subprocess_id++;
    subprocess_callbacks[subprocess_id] = callback;
    spawn(new Array("cinnamon-subprocess-wrapper", subprocess_id.toString()).concat(args));
}