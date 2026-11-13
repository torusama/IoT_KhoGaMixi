const fs=require('node:fs');
const model=fs.readFileSync('model.js','utf8').replace(/if \(typeof module !== 'undefined'\)[\s\S]*$/, '');
const widget=fs.readFileSync('widget.vue','utf8');
const fonts=[['BeVietnamPro-Regular.ttf',400],['BeVietnamPro-SemiBold.ttf',600]].map(([file,weight])=>`@font-face{font-family:'Be Vietnam Pro';font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/ttf;base64,${fs.readFileSync('fonts/'+file).toString('base64')}) format('truetype');}`).join('\n');
const styles=fonts+'\n'+fs.readFileSync('styles.css','utf8');
const nodes=[
{id:'f062',type:'tab',label:'F06.2 Smart Posture frontend',disabled:false,info:'Isolated demo and explicit F06.1 integration links.'},
{id:'base062',type:'ui-base',name:'Smart Posture Tracker',path:'/spt',appIcon:'',includeClientData:true,acceptsClientConfig:['ui-control','ui-notification'],showPathInSidebar:false,headerContent:'dashboard',navigationStyle:'fixed',titleBarStyle:'default'},
{id:'theme062',type:'ui-theme',name:'SPT',colors:{surface:'#ffffff',primary:'#7186c9',bgPage:'#f5f6fb',groupBg:'#f5f6fb',groupOutline:'#f5f6fb'},sizes:{density:'default',pagePadding:'12px',groupGap:'12px',groupBorderRadius:'12px',widgetGap:'12px'}},
{id:'style062',type:'ui-template',z:'f062',group:'',page:'',ui:'base062',name:'SPT shared typography and theme',format:styles,templateScope:'site:style',storeOutMessages:false,passthru:false,resendOnRefresh:false,x:430,y:380,wires:[[]]},
{id:'tick062',type:'inject',z:'f062',name:'One second / demo tick',props:[{p:'payload'}],repeat:'1',once:true,onceDelay:0.2,payload:'{"kind":"tick"}',payloadType:'json',x:150,y:100,wires:[['state062']]},
{id:'in062',type:'link in',z:'f062',name:'F06.1 normalized events and ACK',links:[],x:105,y:180,wires:[['state062']]},
{id:'state062',type:'function',z:'f062',name:'Frontend state, command correlation and demo',func:model+"\nconst mode = (env.get('SPT_MODE') || 'production').toLowerCase();\nconst r=step(flow.get('sptFrontendState'),msg.payload,Date.now(),mode);\nflow.set('sptFrontendState',r.state);\nreturn [{payload:r.state},r.emit.map(payload=>({payload}))];",outputs:2,noerr:0,initialize:'',finalize:'',libs:[],x:440,y:120,wires:[['u0','u1','u2','u3'],['out062']]},
{id:'out062',type:'link out',z:'f062',name:'F06.1 command adapter OUT',mode:'link',links:[],x:765,y:180,wires:[]}
];
['Dashboard','History','Progress','Settings'].forEach((name,i)=>{
 nodes.push({id:'p'+i,type:'ui-page',name,ui:'base062',path:'/'+name.toLowerCase(),icon:['view-dashboard','history','chart-line','cog'][i],layout:'grid',theme:'theme062',breakpoints:[{name:'Default',px:'0',cols:'12'},{name:'Tablet',px:'576',cols:'12'},{name:'Desktop',px:'1024',cols:'12'}],order:i+1,className:'',visible:true,disabled:false});
 nodes.push({id:'g'+i,type:'ui-group',name,page:'p'+i,width:'12',height:'0',order:1,showTitle:false,className:'',visible:true,disabled:false,groupType:'default'});
 nodes.push({id:'u'+i,type:'ui-template',z:'f062',group:'g'+i,page:'',ui:'',name:'F06.2 '+name,order:1,width:12,height:0,head:'',format:widget.replace('PAGE_NAME',JSON.stringify(name)),storeOutMessages:true,passthru:false,resendOnRefresh:true,templateScope:'local',className:'',x:825,y:80+i*55,wires:[['state062']]});
});
fs.writeFileSync('flows_spt_frontend.json',JSON.stringify(nodes,null,2)+'\n');
