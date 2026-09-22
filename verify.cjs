'use strict';
// 在内存中检查时间、绘图参数和操作逻辑，不启动浏览器或生成截图。
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createHash}=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
assert.ok(!html.includes('彩虹'),'page text no longer promises a rainbow');
const scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m=>m[1]);
assert.ok(scripts.indexOf('vendor/p5.min.js')>=0,'local p5 is present');
assert.ok(scripts.indexOf('vendor/p5.min.js')<scripts.indexOf('xiaokui-car.js'),'p5 loads before cat drawing');
assert.ok(scripts.indexOf('xiaokui-car.js')<scripts.indexOf('scene.js'),'cat drawing loads before animation');
assert.ok(scripts.indexOf('sound.js')>=0&&scripts.indexOf('sound.js')<scripts.indexOf('scene.js'),'sound support loads before animation');
assert.ok(!/<header\b|id="phase"|造型稿/.test(html),'corner labels are removed');
for(const [,resource] of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  if(/^(?:[a-z]+:|#|\/\/)/i.test(resource))continue;
  assert.ok(fs.existsSync(path.join(__dirname,resource.split(/[?#]/)[0])),`missing resource: ${resource}`);
}

function harness(reducedMotion=false){
  let calls=0,fillEnabled=true,strokeEnabled=true,matrix=[1,0,0,1,0,0],shape=[];
  let capture=null,hash=null,rotations=null,lines=null,checkingBalloon=false,balloonBodies=0;
  const p5Stack=[],contextStack=[];
  const finite=(value,label)=>{
    if(typeof value==='number')assert.ok(Number.isFinite(value),`${label}: non-finite value`);
    else if(Array.isArray(value))value.forEach(v=>finite(v,label));
  };
  const record=(name,args=[])=>{
    calls++;args.forEach(v=>finite(v,name));
    if(hash)hash.update(`${name}:${JSON.stringify(args)}\n`);
  };
  const multiply=m=>{
    const [a,b,c,d,e,f]=matrix,[g,h,i,j,k,l]=m;
    matrix=[a*g+c*h,b*g+d*h,a*i+c*j,b*i+d*j,a*k+c*l+e,b*k+d*l+f];
  };
  const point=(x,y)=>{
    if(!capture)return;
    const [a,b,c,d,e,f]=matrix,px=a*x+c*y+e,py=b*x+d*y+f;
    capture.minX=Math.min(capture.minX,px);capture.maxX=Math.max(capture.maxX,px);
    capture.minY=Math.min(capture.minY,py);capture.maxY=Math.max(capture.maxY,py);
  };
  const points=args=>{for(let i=0;i+1<args.length;i+=2)point(args[i],args[i+1])};
  const ellipseBounds=(x,y,w,h=w)=>{
    for(const dx of [-w/2,w/2])for(const dy of [-h/2,h/2])point(x+dx,y+dy);
  };
  const contextState={globalAlpha:1,fillStyle:'#000000',strokeStyle:'#000000',lineWidth:1};
  const ctx=new Proxy(contextState,{
    set(target,key,value){finite(value,`canvas.${String(key)}`);target[key]=value;if(hash)record(`canvas.${String(key)}`,[value]);return true;}
  });
  const gradient=(name,args)=>{
    record(name,args);
    return {addColorStop(...values){record('addColorStop',values);assert.ok(values[0]>=0&&values[0]<=1,'gradient offset');}};
  };
  ctx.save=()=>{record('canvas.save');contextStack.push({matrix:[...matrix],globalAlpha:ctx.globalAlpha,fillStyle:ctx.fillStyle,strokeStyle:ctx.strokeStyle,lineWidth:ctx.lineWidth})};
  ctx.restore=()=>{
    record('canvas.restore');assert.ok(contextStack.length,'canvas.restore without save');
    const saved=contextStack.pop();matrix=saved.matrix;for(const key of ['globalAlpha','fillStyle','strokeStyle','lineWidth'])ctx[key]=saved[key];
  };
  ctx.createRadialGradient=(...args)=>gradient('createRadialGradient',args);
  ctx.createLinearGradient=(...args)=>gradient('createLinearGradient',args);
  const eventTarget=()=>({listeners:{},addEventListener(k,v){
    const previous=this.listeners[k];this.listeners[k]=previous?event=>{previous(event);v(event)}:v;
  }});
  const elements={};
  for(const [,tagName,attributes,id] of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const classes=new Set((attributes.match(/\bclass="([^"]*)"/)?.[1]||'').split(/\s+/).filter(Boolean));
    const properties={};
    elements[id]={...eventTarget(),id,tagName:tagName.toUpperCase(),value:'0',textContent:'',attributes:{},disabled:/\bdisabled\b/.test(attributes),
      setAttribute(k,v){this.attributes[k]=String(v)},getAttribute(k){return this.attributes[k]??null},
      style:{setProperty(k,v){properties[k]=String(v)},getPropertyValue(k){return properties[k]||''}},
      classList:{add(...values){values.forEach(v=>classes.add(v))},remove(...values){values.forEach(v=>classes.delete(v))},contains(v){return classes.has(v)},toggle(v,force){const add=force===undefined?!classes.has(v):force;add?classes.add(v):classes.delete(v);return add}},
      contains(element){return element===this||(this.id==='play-controls'&&/^play-/.test(element?.id||''))},
      getBoundingClientRect(){return {top:1100,bottom:1184,left:70,right:830,width:760,height:84}}
    };
  }
  const document={...eventTarget(),hidden:false,activeElement:{tagName:'BODY'},getElementById(id){assert.ok(elements[id],`unknown element ${id}`);return elements[id]}};
  let timerNow=0,timerSerial=0;const timers=new Map();
  const setTimeout=(callback,delay=0)=>{const id=++timerSerial;timers.set(id,{callback,at:timerNow+delay});return id};
  const clearTimeout=id=>timers.delete(id);
  const advanceTimers=ms=>{timerNow+=ms;for(const [id,timer] of timers)if(timer.at<=timerNow){timers.delete(id);timer.callback()}};
  const soundCalls=[],sounds=[];
  class DrivingSound{
    constructor(events=[]){this.events=events;this.enabled=false;this.failNextEnable=false;sounds.push(this)}
    async setEnabled(enabled){soundCalls.push({method:'setEnabled',enabled});if(this.failNextEnable){this.failNextEnable=false;throw Error('模拟音频设备不可用')}this.enabled=enabled;return enabled}
    update(...args){soundCalls.push({method:'update',args})}
    invalidate(...args){soundCalls.push({method:'invalidate',args})}
    silence(...args){soundCalls.push({method:'silence',args})}
  }
  const window={...eventTarget(),devicePixelRatio:2,innerHeight:1200,innerWidth:900,matchMedia:()=>({matches:reducedMotion}),setTimeout,clearTimeout,DrivingSound};
  const env={Math,console,drawingContext:ctx,CLOSE:'close',ROUND:'round',PI:Math.PI,TWO_PI:Math.PI*2,HALF_PI:Math.PI/2,CENTER:'center',CORNER:'corner',document,window,DrivingSound,setTimeout,clearTimeout,performance:{now:()=>timerNow},deltaTime:1000/60};
  const transforms={
    translate:(x,y)=>multiply([1,0,0,1,x,y]),
    rotate:a=>multiply([Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]),
    scale:(x,y=x)=>multiply([x,0,0,y,0,0])
  };
  for(const name of ['background','noStroke','fill','beginShape','vertex','endShape','noFill','stroke','strokeWeight','bezier','push','pop','translate','rotate','scale','bezierVertex','quadraticVertex','triangle','quad','ellipse','line','circle','rect','arc','point','strokeCap','strokeJoin','pixelDensity','frameRate','ellipseMode','rectMode'])env[name]=(...args)=>{
    record(name,args);
    if(name==='rotate'&&rotations)rotations.push(args[0]);
    if(name==='line'&&lines)lines.push(args);
    if(transforms[name])transforms[name](...args);
    if(name==='push')p5Stack.push({fillEnabled,strokeEnabled,matrix:[...matrix]});
    if(name==='pop'){
      assert.ok(p5Stack.length,'p5 pop without push');const saved=p5Stack.pop();
      fillEnabled=saved.fillEnabled;strokeEnabled=saved.strokeEnabled;matrix=saved.matrix;
    }
    if(name==='fill')fillEnabled=true;
    if(name==='noFill')fillEnabled=false;
    if(name==='stroke')strokeEnabled=true;
    if(name==='noStroke')strokeEnabled=false;
    if(name==='beginShape')shape=[];
    if(['vertex','bezierVertex','quadraticVertex'].includes(name))shape.push(...args);
    if(name==='endShape'){
      if(fillEnabled||strokeEnabled)points(shape);
      if(capture)capture.shapes.push({filled:fillEnabled,points:shape.length/2});
      if(checkingBalloon&&shape.length>=160){assert.ok(fillEnabled,'balloon body must enable p5 fill after strings');balloonBodies++;}
    }
    if(fillEnabled||strokeEnabled){
      if(['line','bezier','triangle','quad','point'].includes(name))points(args);
      if(['ellipse','circle','arc'].includes(name))ellipseBounds(args[0],args[1],args[2],name==='circle'?args[2]:args[3]);
      if(name==='rect'){const [x,y,w,h]=args;points([x,y,x+w,y,x+w,y+h,x,y+h])}
    }
  };
  env.createCanvas=(w,h)=>{record('createCanvas',[w,h]);return {parent(id){assert.ok(elements[id],`canvas parent ${id}`)}}};
  vm.createContext(env);
  for(const file of ['xiaokui-car.js','scene.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),env,{filename:file});
  const evaluate=source=>vm.runInContext(source,env);
  assert.equal(evaluate('typeof drawRainbow'),'undefined','rainbow drawing is removed');
  const api=evaluate('({W,H,DURATION,BALLOON_COUNT,CAR_SCALE,DRIVE_SPEED,DEPART_AT,DEPART_SCREEN_SPEED,CAMERA_RELEASE_SECONDS,setup,draw,renderScene,drawXiaokuiCar,drawBalloon,balloonState,balloonString,attached,attachedVelocity,release,vehiclePose,carX,driveDistance,cameraTravel,world,tether,balloonSize,balloonTilt})');
  const balanced=()=>{
    assert.equal(p5Stack.length,0,'unbalanced p5 push/pop');assert.equal(contextStack.length,0,'unbalanced canvas save/restore');
    assert.deepEqual(matrix,[1,0,0,1,0,0],'transform leaked outside draw');assert.equal(ctx.globalAlpha,1,'opacity leaked outside draw');
  };
  return {api,env,elements,document,evaluate,balanced,advanceTimers,sounds,soundCalls,get calls(){return calls},
    bounds(fn){capture={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity,shapes:[]};fn();const result=capture;capture=null;balanced();return result},
    signature(fn){hash=createHash('sha256');fn();const result=hash.digest('hex');hash=null;balanced();return result},
    rotations(fn){rotations=[];fn();const result=rotations;rotations=null;balanced();return result},
    lines(fn){lines=[];fn();const result=lines;lines=null;balanced();return result},
    balloon(fn){checkingBalloon=true;balloonBodies=0;fillEnabled=false;strokeEnabled=true;fn();checkingBalloon=false;assert.ok(balloonBodies>0,'balloon has a filled body');balanced()}
  };
}

const test=harness(),api=test.api;
assert.equal(api.W,900);assert.equal(api.H,1200);assert.ok(api.DURATION>0);assert.equal(api.BALLOON_COUNT,35,'seven more balloons fill the bouquet');
assert.equal(api.CAR_SCALE,.64,'cat and car shrink a further 20 percent');
assert.equal(api.DRIVE_SPEED,360,'driving is 44 percent faster than the accepted 250 pixel speed');
assert.ok(api.DEPART_AT>api.release(api.BALLOON_COUNT-1)&&api.DEPART_AT<api.DURATION-2,'departure follows every balloon release and leaves room for a full exit');
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const inFrame=(bounds,label,margin=0)=>{
  assert.ok(bounds.minX>=margin&&bounds.maxX<=api.W-margin&&bounds.minY>=margin&&bounds.maxY<=api.H-margin,`${label} outside frame: ${JSON.stringify(bounds)}`);
};
const derivative=(fn,t,h=1e-4)=>{
  const before=fn(t-h),after=fn(t+h);
  return {x:(after.x-before.x)/(2*h),y:(after.y-before.y)/(2*h)};
};
for(let i=0;i<api.BALLOON_COUNT;i++){
  const r=api.release(i),h=1e-5;
  assert.ok(r>=1&&r<api.DURATION-2,'balloon releases during the drive');
  if(i>0)assert.ok(r>api.release(i-1),'balloons release progressively, never simultaneously');
  const before=api.balloonState(i,r-h).p,at=api.balloonState(i,r).p,after=api.balloonState(i,r+h).p;
  assert.ok(distance(before,after)<.01,`release position continuity ${i}`);
  assert.ok(distance(api.balloonString(i,r-h).end,api.balloonString(i,r+h).end)<.01,`string release continuity ${i}`);
  const previousVelocity={x:(at.x-before.x)/h,y:(at.y-before.y)/h};
  const nextVelocity={x:(after.x-at.x)/h,y:(after.y-at.y)/h};
  assert.ok(distance(previousVelocity,nextVelocity)<.05,`release velocity continuity ${i}`);
  assert.ok(distance(api.attachedVelocity(i,r),previousVelocity)<.05,`released balloon inherits its attached velocity ${i}`);
  for(let t=0;t<r;t+=.2){
    const anchor=api.tether(t),p=api.balloonState(i,t).p;
    assert.ok(distance(p,api.attached(i,t))<1e-8,`balloon follows car before release ${i}`);
    assert.ok(p.x<anchor.x&&p.y<anchor.y,`attached balloon stays behind and above rear anchor ${i}`);
    assert.ok(api.balloonTilt(i,t)<0,`attached balloon leans back ${i}`);
  }
  const released=api.balloonState(i,r+1).p,stillAttached=api.attached(i,r+1);
  assert.ok(released.x<stillAttached.x-25,`released balloon falls noticeably behind car after one second ${i}`);
  const drifting=derivative(t=>api.balloonState(i,t).p,r+3);
  assert.ok(drifting.x<0&&drifting.y<0,`released balloon drifts left and upward ${i}`);
  assert.ok(api.balloonState(i,api.DURATION).p.y<at.y-200,`released balloon continues to rise ${i}`);
  const opening=api.attached(i,0),anchor=api.tether(0);
  assert.ok(opening.x<anchor.x&&opening.y<anchor.y,`opening balloon is behind car ${i}`);
  inFrame(test.bounds(()=>api.drawBalloon(i,0,'body')),`initial balloon ${i}`,8);
}
assert.ok(api.release(0)<1.5,'first balloon lets go soon after driving starts');
assert.ok(Array.from({length:api.BALLOON_COUNT},(_,i)=>api.release(i)).filter(t=>t<3).length>=7,'first three seconds visibly release multiple balloons');
const vehicleBounds=t=>{
  const p=api.vehiclePose(t);
  return test.bounds(()=>{test.env.push();test.env.translate(p.x,p.y);test.env.scale(api.CAR_SCALE);api.drawXiaokuiCar(t,api.driveDistance(t)/api.CAR_SCALE);test.env.pop()});
};
const outsideFrame=bounds=>bounds.maxX< -1||bounds.minX>api.W+1||bounds.maxY< -1||bounds.minY>api.H+1;
const balloonOutside=(i,t)=>outsideFrame(test.bounds(()=>api.drawBalloon(i,t)));
const valueSpeed=(fn,t,h=1e-4)=>(fn(t+h)-fn(t-h))/(2*h);
let allBalloonsOutAt=null,wholeCarOutAt=null;
for(let i=0;i<api.BALLOON_COUNT;i++){
  assert.ok(balloonOutside(i,api.DEPART_AT),`balloon ${i}, including the full string, has left before the car departs`);
}
for(let frame=0;frame<=api.DURATION*60;frame++){
  const t=frame/60,p=api.vehiclePose(t);
  assert.equal(p.x,api.carX(t),'vehicle horizontal position');assert.equal(p.angle,0,'level vehicle');
  assert.ok(distance(api.tether(t),api.world(t,{x:-152,y:-177}))<1e-8,'strings anchored at rear');
  const bounds=vehicleBounds(t);
  if(wholeCarOutAt===null&&bounds.minX>api.W+1)wholeCarOutAt=t;
  if(allBalloonsOutAt===null&&t>=api.release(api.BALLOON_COUNT-1)
    &&Array.from({length:api.BALLOON_COUNT},(_,i)=>balloonOutside(i,t)).every(Boolean))allBalloonsOutAt=t;
  if(t<=api.DEPART_AT){
    assert.equal(p.x,470,'camera holds the vehicle until every balloon leaves');
    inFrame(bounds,`vehicle before departure at ${t}s`,8);
  }else{
    assert.ok(p.x>470,'vehicle only begins moving right on screen after balloons leave');
    for(let i=0;i<api.BALLOON_COUNT;i++)assert.ok(balloonOutside(i,t),`departed balloon ${i} does not reenter at ${t}s`);
  }
}
inFrame(vehicleBounds(api.DEPART_AT),'whole vehicle at exact departure time',8);
assert.ok(allBalloonsOutAt!==null&&allBalloonsOutAt<=api.DEPART_AT,'visible balloon clearance precedes the camera falling behind');
assert.ok(wholeCarOutAt>api.DEPART_AT,'complete vehicle exit follows balloon clearance');
assert.ok(vehicleBounds(api.DURATION).minX>api.W+8,'the entire vehicle exits by the end');
for(let t=0;t<api.DURATION;t+=.125){
  const next=Math.min(api.DURATION,t+.001),dt=next-t;
  const worldSpeed=(api.driveDistance(next)-api.driveDistance(t))/dt;
  const screenSpeed=(api.carX(next)-api.carX(t))/dt;
  const cameraSpeed=(api.cameraTravel(next)-api.cameraTravel(t))/dt;
  assert.ok(Math.abs(worldSpeed-360)<1e-6,'actual driving speed stays constant throughout playback');
  assert.ok(screenSpeed>=-1e-7&&screenSpeed<=api.DEPART_SCREEN_SPEED+1e-6,'screen speed never reverses or overshoots');
  assert.ok(Math.abs(screenSpeed+cameraSpeed-worldSpeed)<1e-6,'car and road motion add to the same real driving speed');
  if(t<=api.DEPART_AT&&next<=api.DEPART_AT)assert.equal(api.carX(next),api.carX(t),'camera fully follows before departure');
}
const transitionEnd=api.DEPART_AT+api.CAMERA_RELEASE_SECONDS;
for(const t of [api.DEPART_AT,transitionEnd]){
  assert.ok(Math.abs(valueSpeed(api.carX,t-.0002)-valueSpeed(api.carX,t+.0002))<.1,'camera release has no velocity jump');
  for(let i=0;i<api.BALLOON_COUNT;i++){
    assert.ok(distance(api.balloonState(i,t-.00001).p,api.balloonState(i,t+.00001).p)<.02,'balloon position is continuous when the camera falls behind');
    assert.ok(distance(derivative(at=>api.balloonState(i,at).p,t-.0002),derivative(at=>api.balloonState(i,at).p,t+.0002))<.2,'balloon velocity is continuous when the camera falls behind');
  }
}
assert.ok(Math.abs(valueSpeed(api.carX,transitionEnd+.1)-210)<1e-6,'car leaves at the selected screen speed');
assert.ok(Math.abs(valueSpeed(api.cameraTravel,transitionEnd+.1)-150)<1e-6,'camera keeps moving more slowly after departure');
const firstRoadX=t=>{
  const lines=test.lines(()=>api.renderScene(t));
  const marker=lines.find(values=>values[1]===1132&&values[3]===1132);
  assert.ok(marker,'road motion is present in the actual rendering');return marker[0];
};
const roadAt=transitionEnd+.1,roadStep=.1;
const roadShift=((firstRoadX(roadAt)-firstRoadX(roadAt+roadStep))%160+160)%160;
assert.ok(Math.abs(roadShift/roadStep-150)<1e-6,'drawn road markers match the slower tracking camera');
const stationaryRotations=test.rotations(()=>api.drawXiaokuiCar(2,0));
const travelledRotations=test.rotations(()=>api.drawXiaokuiCar(2,170));
assert.equal(stationaryRotations.length,travelledRotations.length,'distance preserves drawing structure');
const changedAngles=travelledRotations.map((a,i)=>a-stationaryRotations[i]).filter(a=>Math.abs(a)>1e-9);
assert.equal(changedAngles.length,2,'both wheels consume the supplied travel distance');
assert.ok(changedAngles[0]>3&&changedAngles[0]<4&&Math.abs(changedAngles[0]-changedAngles[1])<1e-9,'both tires rotate forward together at a visible rate');
const originalCar=test.env.drawXiaokuiCar,carInputs=[];
const visibilityTimes=[0,6,api.DEPART_AT,api.DEPART_AT+.35,api.DURATION-.1,api.DURATION];
try{
  test.env.drawXiaokuiCar=(t,travel)=>{carInputs.push({t,travel,opacity:test.env.drawingContext.globalAlpha});return originalCar(t,travel)};
  for(const t of visibilityTimes){api.renderScene(t);test.balanced()}
}finally{test.env.drawXiaokuiCar=originalCar}
assert.equal(carInputs.length,visibilityTimes.length,'scene draws the car once per frame');
carInputs.forEach((input,i)=>{
  assert.equal(input.t,visibilityTimes[i],'scene passes the current time to the vehicle');
  assert.equal(input.opacity,1,`vehicle stays opaque at ${input.t}s and leaves through movement`);
  assert.ok(Math.abs(input.travel*api.CAR_SCALE-api.driveDistance(input.t))<1e-8,'wheel travel accounts for the smaller vehicle scale');
});
for(const t of [0,2,4,6,8,10,api.DURATION])for(let i=0;i<api.BALLOON_COUNT;i++){
  test.balloon(()=>api.drawBalloon(i,t));
  const body=test.bounds(()=>api.drawBalloon(i,t,'body'));
  assert.equal(body.shapes.filter(s=>s.filled&&s.points>=80).length,1,'balloon retains one filled body after release');
  assert.ok(body.maxX-body.minX>=35&&body.maxY-body.minY>=45,'balloon keeps its size while drifting out of view');
}
for(let n=0;n<=api.DURATION*60;n++){
  const t=n/60;
  for(let i=0;i<api.BALLOON_COUNT;i++){
    const state=api.balloonState(i,t);
    assert.ok([state.p.x,state.p.y,state.age,state.flight].every(Number.isFinite),'finite balloon state');
    assert.ok(state.flight>=0&&state.flight<=1&&state.age>=0,'bounded release progress');
    assert.ok(!Object.hasOwn(state,'morph'),'balloons no longer morph into another shape');
    const string=api.balloonString(i,t);
    assert.ok([string.tip.x,string.tip.y,string.end.x,string.end.y,string.opacity].every(Number.isFinite),'finite string state');
    assert.ok(string.opacity>=0&&string.opacity<=1,'bounded string opacity');
  }
  api.renderScene(t);test.balanced();
}
for(const t of [0,1.1,3,5.5,7,api.DEPART_AT-.001,api.DEPART_AT,api.DEPART_AT+.2,transitionEnd,api.DURATION-.01]){
  const before=test.signature(()=>api.renderScene(t));api.renderScene(api.DURATION-.2);api.renderScene(1);
  assert.equal(test.signature(()=>api.renderScene(t)),before,`draw output independent of seek order at ${t}s`);
}

// 最小 DOM 模拟：检查播放条的状态切换、进度拖动与音效同步，不代替实际浏览器验收。
async function verifyControls(){
  const controls=test.elements['play-controls'],play=test.elements['play-toggle'];
  const progress=test.elements['play-progress'],time=test.elements['play-time'];
  const restart=test.elements['play-restart'],speed=test.elements['play-speed'],sound=test.elements['play-sound'];
  const invalidations=()=>test.soundCalls.filter(call=>call.method==='invalidate').length;
  const audioFrame=()=>test.soundCalls.filter(call=>call.method==='update').at(-1)?.args[0];
  api.setup();
  assert.equal(test.evaluate('paused'),false,'normal playback starts active');
  assert.equal(test.evaluate('playbackRate'),1,'default playback speed');
  assert.equal(play.textContent,'暂停','initial button matches active playback');
  assert.equal(play.disabled,false,'playback becomes available after setup');
  assert.equal(progress.disabled,false,'progress becomes available after setup');
  assert.equal(test.sounds.length,1,'one audio controller is shared by playback controls');
  assert.equal(test.sounds[0].enabled,false,'sound needs deliberate opt-in');
  assert.equal(test.sounds[0].events.length,api.BALLOON_COUNT,'each departing balloon has one sound event');
  for(const [i,event] of test.sounds[0].events.entries()){
    assert.equal(event.time,api.release(i),'sound release time comes from the visible balloon motion');
    assert.equal(event.index,i,'balloon sound retains its event index');
    assert.ok(event.x>=-1&&event.x<=1,'balloon sound stereo position is valid');
  }
  assert.equal(audioFrame().running,true,'sound receives initial playback intent');
  assert.equal(audioFrame().duration,api.DURATION,'sound shares the animation duration');
  assert.equal(audioFrame().vehicleGain,1,'car audio starts at the intended level');
  assert.ok(audioFrame().vehiclePan>=-1&&audioFrame().vehiclePan<=1,'vehicle stereo position is valid');

  play.onclick();assert.equal(test.evaluate('paused'),true,'pause button');
  assert.equal(audioFrame().running,false,'pause stops sound as well as the scene');
  const pausedAt=test.evaluate('clock');api.draw();assert.equal(test.evaluate('clock'),pausedAt,'paused clock stays still');
  let invalidated=invalidations();
  const seekTime=Math.floor(api.DURATION*.7)+.23;
  progress.value=String(seekTime);progress.listeners.input();assert.equal(test.evaluate('clock'),seekTime,'seek input updates clock');
  assert.ok(time.textContent.includes(`00:${String(Math.floor(seekTime)).padStart(2,'0')}`),'seek updates elapsed time');
  assert.ok(Math.abs(parseFloat(progress.style.getPropertyValue('--progress'))-seekTime/api.DURATION*100)<.01,'seek updates progress fill');
  assert.ok(progress.attributes['aria-valuetext'],'progress exposes spoken time');
  assert.ok(invalidations()>invalidated,'seek invalidates previously scheduled sound events');
  progress.value='99';progress.listeners.input();assert.equal(test.evaluate('clock'),api.DURATION,'seek clamps at end');
  assert.equal(audioFrame().vehicleGain,0,'car sound fades away when the whole car is offscreen');
  assert.equal(audioFrame().vehiclePan,1,'departing car sound moves right');
  progress.value='-1';progress.listeners.input();assert.equal(test.evaluate('clock'),0,'seek clamps at beginning');
  assert.equal(audioFrame().vehicleGain,1,'rewinding restores the car audio level');

  restart.onclick();assert.equal(test.evaluate('clock'),0,'replay resets clock');assert.equal(test.evaluate('paused'),false,'replay resumes');
  api.draw();assert.ok(test.evaluate('clock')>0,'playing advances clock');
  progress.listeners.pointerdown({pointerId:1});
  assert.equal(test.evaluate('draggingProgress'),true,'pointer drag is tracked');
  assert.equal(test.evaluate('paused'),false,'drag preserves user playback intent');
  assert.equal(audioFrame().running,false,'drag silences sound');
  const draggingAt=test.evaluate('clock');api.draw();assert.equal(test.evaluate('clock'),draggingAt,'clock rests during dragging');
  progress.value='6';progress.listeners.input();test.env.window.listeners.pointerup({pointerId:1});
  assert.equal(test.evaluate('draggingProgress'),false,'release finishes drag outside progress bar');
  assert.equal(audioFrame().running,true,'release resumes sound with user playback intent');
  api.draw();assert.ok(test.evaluate('clock')>6,'playing resumes after drag');
  play.onclick();
  for(const event of ['pointercancel','blur']){
    progress.listeners.pointerdown({pointerId:2});progress.value='7';progress.listeners.input();
    test.env.window.listeners[event]({pointerId:2});
    assert.equal(test.evaluate('draggingProgress'),false,`${event} releases drag state`);
    api.draw();assert.equal(test.evaluate('clock'),7,`${event} preserves a user pause`);
  }

  invalidated=invalidations();
  speed.onclick();assert.equal(test.evaluate('playbackRate'),1.5,'speed advances to 1.5×');
  assert.equal(audioFrame().rate,1.5,'sound uses the new scene rate');
  assert.equal(speed.textContent,'1.5×','speed button displays active rate');
  assert.ok(time.textContent.endsWith(`00:${String(Math.floor(api.DURATION/1.5)).padStart(2,'0')}`),'displayed duration accounts for 1.5× speed');
  assert.ok(invalidations()>invalidated,'speed change invalidates scheduled sounds');
  for(const rate of [2,3,.5,1]){speed.onclick();assert.equal(test.evaluate('playbackRate'),rate,'speed cycles through standard rates')}
  speed.onclick();restart.onclick();test.env.deltaTime=1000/60;api.draw();
  assert.ok(Math.abs(test.evaluate('clock')-.025)<1e-9,'playback rate controls scene time');
  for(let i=0;i<4;i++)speed.onclick();assert.equal(test.evaluate('playbackRate'),1,'restore normal playback rate');

  test.document.hidden=true;test.document.listeners.visibilitychange();
  assert.equal(audioFrame().running,false,'background tab silences sound');
  const hiddenAt=test.evaluate('clock');api.draw();assert.equal(test.evaluate('clock'),hiddenAt,'hidden page does not advance');
  test.document.hidden=false;test.document.listeners.visibilitychange();
  assert.equal(audioFrame().running,true,'foreground tab restores intended sound playback');
  api.draw();assert.ok(test.evaluate('clock')>hiddenAt,'visible page resumes intended playback');
  test.evaluate('clock=DURATION-.01');test.env.deltaTime=1000;api.draw();assert.ok(Math.abs(test.evaluate('clock')-.07)<1e-9,'loop wraps and frame delta is capped');

  let prevented=0;const space={code:'Space',preventDefault(){prevented++}};
  test.document.listeners.keydown(space);assert.equal(test.evaluate('paused'),true,'space pauses');assert.equal(prevented,1,'space stops page scroll');
  for(const tagName of ['INPUT','BUTTON','A']){
    test.document.activeElement={tagName};test.document.listeners.keydown(space);assert.equal(test.evaluate('paused'),true,'focused controls retain keyboard behavior');
  }
  test.document.activeElement={tagName:'BODY'};

  await sound.onclick();assert.equal(test.sounds[0].enabled,true,'sound button enables sound');
  assert.equal(sound.attributes['aria-pressed'],'true','sound opt-in is exposed to assistive technology');
  assert.equal(sound.textContent,'声音开','sound button reports enabled state');
  assert.equal(sound.disabled,false,'sound button recovers after async enabling');
  await sound.onclick();assert.equal(test.sounds[0].enabled,false,'sound button mutes sound');
  test.sounds[0].failNextEnable=true;await sound.onclick();
  assert.equal(sound.disabled,false,'audio failure leaves retry available');
  assert.equal(sound.attributes['aria-pressed'],'false','audio failure never claims sound is enabled');
  await sound.onclick();assert.equal(test.sounds[0].enabled,true,'retry can enable sound');
  const silenceCount=test.soundCalls.filter(call=>call.method==='silence').length;
  test.env.window.listeners.pagehide();
  assert.ok(test.soundCalls.filter(call=>call.method==='silence').length>silenceCount,'leaving the page silences audio');
  test.env.window.listeners.pageshow();
  assert.ok(test.soundCalls.some(call=>call.method==='update'),'scene synchronizes sound with playback');

  // 播放条沿用海边夕阳的靠近底部显示、离开隐藏行为，键盘聚焦和拖动时保留。
  play.onclick();
  test.env.window.listeners.pointermove({pointerType:'mouse',clientX:450,clientY:1190});
  assert.equal(controls.classList.contains('is-hidden'),false,'pointer near controls reveals playback');
  test.document.activeElement=play;controls.listeners.focusin({target:play});
  test.env.window.listeners.pointermove({pointerType:'mouse',clientX:450,clientY:50});
  test.advanceTimers(10000);assert.equal(controls.classList.contains('is-hidden'),false,'keyboard focus keeps controls visible');
  test.document.activeElement={tagName:'BODY'};
  test.env.window.listeners.pointermove({pointerType:'mouse',clientX:450,clientY:50});test.advanceTimers(10000);
  assert.equal(controls.classList.contains('is-hidden'),true,'playback hides outside control area after idle delay');
  test.env.window.listeners.pointermove({pointerType:'mouse',clientX:450,clientY:1190});
  assert.equal(controls.classList.contains('is-hidden'),false,'bottom pointer restores hidden controls');
  test.env.window.listeners.pointermove({pointerType:'touch',clientX:450,clientY:50});
  assert.equal(controls.classList.contains('is-hidden'),false,'touch interaction never hides playback');
  progress.listeners.pointerdown({pointerId:3});
  test.env.window.listeners.pointermove({pointerType:'mouse',clientX:450,clientY:50});
  assert.equal(controls.classList.contains('is-hidden'),false,'progress remains visible while dragging away');
  test.env.window.listeners.pointerup({pointerId:3});
  test.balanced();

  const reduced=harness(true);reduced.api.setup();assert.equal(reduced.evaluate('paused'),true,'reduced motion starts paused');
  reduced.api.draw();assert.equal(reduced.evaluate('clock'),0,'reduced motion has no automatic advance');reduced.balanced();
  console.log(`通过：完整 ${api.DURATION} 秒共 ${api.DURATION*60+1} 个采样帧，${test.calls+reduced.calls} 次绘图调用参数均有限；小葵和汽车再缩小 20%，实际车速恒定为每秒 360 像素，两轮按实际路程转动；全部气球与绳子离开后，镜头才平滑落后、整车驶出画面；气球不重新入画；${api.BALLOON_COUNT} 只气球先向车后倾斜，再逐只松开，位置和速度连续，向左上飘离并保留完整球形；已移除彩虹和角落文案；绘图状态与跳转一致；标准播放条的播放、暂停、重播、拖动、倍速、隐现与音效开关通过；减少动态效果受到尊重；静态资源完整。`);
  console.log(`阶段时间：最后一只气球 ${api.release(api.BALLOON_COUNT-1).toFixed(2)} 秒脱落；球体与绳子约 ${allBalloonsOutAt.toFixed(2)} 秒全部离开；${api.DEPART_AT.toFixed(2)} 秒镜头开始落后；${wholeCarOutAt.toFixed(2)} 秒整辆车驶出画面（边界按每秒 60 帧采样）。`);
  console.log('本检查不替代浏览器中的画面、听感与实际操作验收。');
}
verifyControls().catch(error=>{console.error(error);process.exitCode=1});
