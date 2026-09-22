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
for(const [,resource] of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  if(/^(?:[a-z]+:|#|\/\/)/i.test(resource))continue;
  assert.ok(fs.existsSync(path.join(__dirname,resource.split(/[?#]/)[0])),`missing resource: ${resource}`);
}

function harness(reducedMotion=false){
  let calls=0,fillEnabled=true,strokeEnabled=true,matrix=[1,0,0,1,0,0],shape=[];
  let capture=null,hash=null,rotations=null,checkingBalloon=false,balloonBodies=0;
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
  const elements={};
  for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))elements[id]={id,value:'0',textContent:'',attributes:{},listeners:{},setAttribute(k,v){this.attributes[k]=v},addEventListener(k,v){this.listeners[k]=v}};
  const document={hidden:false,activeElement:{tagName:'BODY'},listeners:{},getElementById(id){assert.ok(elements[id],`unknown element ${id}`);return elements[id]},addEventListener(k,v){this.listeners[k]=v}};
  const env={Math,console,drawingContext:ctx,CLOSE:'close',ROUND:'round',PI:Math.PI,TWO_PI:Math.PI*2,HALF_PI:Math.PI/2,CENTER:'center',CORNER:'corner',document,window:{devicePixelRatio:2,matchMedia:()=>({matches:reducedMotion})},deltaTime:1000/60};
  const transforms={
    translate:(x,y)=>multiply([1,0,0,1,x,y]),
    rotate:a=>multiply([Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]),
    scale:(x,y=x)=>multiply([x,0,0,y,0,0])
  };
  for(const name of ['background','noStroke','fill','beginShape','vertex','endShape','noFill','stroke','strokeWeight','bezier','push','pop','translate','rotate','scale','bezierVertex','quadraticVertex','triangle','quad','ellipse','line','circle','rect','arc','point','strokeCap','strokeJoin','pixelDensity','frameRate','ellipseMode','rectMode'])env[name]=(...args)=>{
    record(name,args);
    if(name==='rotate'&&rotations)rotations.push(args[0]);
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
  const api=evaluate('({W,H,DURATION,BALLOON_COUNT,CAR_SCALE,setup,draw,renderScene,drawXiaokuiCar,drawBalloon,balloonState,balloonString,attached,attachedVelocity,release,vehiclePose,carX,driveDistance,cameraTravel,world,tether,balloonSize,balloonTilt})');
  const balanced=()=>{
    assert.equal(p5Stack.length,0,'unbalanced p5 push/pop');assert.equal(contextStack.length,0,'unbalanced canvas save/restore');
    assert.deepEqual(matrix,[1,0,0,1,0,0],'transform leaked outside draw');assert.equal(ctx.globalAlpha,1,'opacity leaked outside draw');
  };
  return {api,env,elements,document,evaluate,balanced,get calls(){return calls},
    bounds(fn){capture={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity,shapes:[]};fn();const result=capture;capture=null;balanced();return result},
    signature(fn){hash=createHash('sha256');fn();const result=hash.digest('hex');hash=null;balanced();return result},
    rotations(fn){rotations=[];fn();const result=rotations;rotations=null;balanced();return result},
    balloon(fn){checkingBalloon=true;balloonBodies=0;fillEnabled=false;strokeEnabled=true;fn();checkingBalloon=false;assert.ok(balloonBodies>0,'balloon has a filled body');balanced()}
  };
}

const test=harness(),api=test.api;
assert.equal(api.W,900);assert.equal(api.H,1200);assert.equal(api.DURATION,18);assert.equal(api.BALLOON_COUNT,28);
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
  assert.ok(r>=1&&r<6.5,'balloon releases during the drive');
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
  assert.ok(api.balloonState(i,18).p.y<at.y-200,`released balloon continues to rise ${i}`);
  const opening=api.attached(i,0),anchor=api.tether(0);
  assert.ok(opening.x<anchor.x&&opening.y<anchor.y,`opening balloon is behind car ${i}`);
  inFrame(test.bounds(()=>api.drawBalloon(i,0,'body')),`initial balloon ${i}`,8);
}
assert.ok(api.release(0)<1.5,'first balloon lets go soon after driving starts');
assert.ok(Array.from({length:api.BALLOON_COUNT},(_,i)=>api.release(i)).filter(t=>t<3).length>=7,'first three seconds visibly release multiple balloons');
for(let frame=0;frame<=api.DURATION*60;frame++){
  const t=frame/60;
  const p=api.vehiclePose(t);
  assert.equal(p.x,api.carX(t),'vehicle horizontal position');assert.equal(p.angle,0,'level vehicle');
  assert.equal(p.x,470,'camera keeps the vehicle at its fixed screen position');
  assert.ok(distance(api.tether(t),api.world(t,{x:-152,y:-177}))<1e-8,'strings anchored at rear');
  const bounds=test.bounds(()=>{test.env.push();test.env.translate(p.x,p.y);test.env.scale(api.CAR_SCALE);api.drawXiaokuiCar(t,api.driveDistance(t)/api.CAR_SCALE);test.env.pop()});
  inFrame(bounds,`vehicle at ${t}s`,8);
}
for(let t=0;t<api.DURATION;t+=.125){
  const next=Math.min(api.DURATION,t+.001),dt=next-t;
  assert.ok(Math.abs((api.driveDistance(next)-api.driveDistance(t))/dt-250)<1e-6,'actual driving speed stays constant throughout playback');
  assert.equal(api.carX(next),api.carX(t),'tracking camera keeps screen position constant');
  assert.equal(api.cameraTravel(t),api.driveDistance(t),'camera tracks the full actual road travel');
}
const stationaryRotations=test.rotations(()=>api.drawXiaokuiCar(2,0));
const travelledRotations=test.rotations(()=>api.drawXiaokuiCar(2,170));
assert.equal(stationaryRotations.length,travelledRotations.length,'distance preserves drawing structure');
const changedAngles=travelledRotations.map((a,i)=>a-stationaryRotations[i]).filter(a=>Math.abs(a)>1e-9);
assert.equal(changedAngles.length,2,'both wheels consume the supplied travel distance');
assert.ok(changedAngles[0]>3&&changedAngles[0]<4&&Math.abs(changedAngles[0]-changedAngles[1])<1e-9,'both tires rotate forward together at a visible rate');
const originalCar=test.env.drawXiaokuiCar,carInputs=[];
const visibilityTimes=[0,6,17.9,18];
try{
  test.env.drawXiaokuiCar=(t,travel)=>{carInputs.push({t,travel,opacity:test.env.drawingContext.globalAlpha});return originalCar(t,travel)};
  for(const t of visibilityTimes){api.renderScene(t);test.balanced()}
}finally{test.env.drawXiaokuiCar=originalCar}
assert.equal(carInputs.length,visibilityTimes.length,'scene draws the car once per frame');
carInputs.forEach((input,i)=>{
  assert.equal(input.t,visibilityTimes[i],'scene passes the current time to the vehicle');
  assert.equal(input.opacity,1,`vehicle remains fully visible at ${input.t}s, including the loop boundary`);
  assert.ok(Math.abs(input.travel*api.CAR_SCALE-api.driveDistance(input.t))<1e-8,'wheel travel accounts for the smaller vehicle scale');
});
for(const t of [0,2,4,6,8,10,12,16,18])for(let i=0;i<api.BALLOON_COUNT;i++){
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
for(const t of [0,1.1,3,5.5,7,10,12,15,17.9]){
  const before=test.signature(()=>api.renderScene(t));api.renderScene(16);api.renderScene(1);
  assert.equal(test.signature(()=>api.renderScene(t)),before,`draw output independent of seek order at ${t}s`);
}

// 最小 DOM 模拟：确认控件真正改变时钟，减少动态效果偏好受到尊重。
api.setup();assert.equal(test.evaluate('paused'),false,'normal playback starts active');
test.elements.play.onclick();assert.equal(test.evaluate('paused'),true,'pause button');
const pausedAt=test.evaluate('clock');api.draw();assert.equal(test.evaluate('clock'),pausedAt,'paused clock stays still');
test.elements.seek.value='13.23';test.elements.seek.listeners.input();assert.equal(test.evaluate('clock'),13.23,'seek input updates clock');
assert.ok(test.elements.time.textContent.includes('00:13'),'seek updates time label');
test.elements.restart.onclick();assert.equal(test.evaluate('clock'),0,'replay resets clock');assert.equal(test.evaluate('paused'),false,'replay resumes');
api.draw();assert.ok(test.evaluate('clock')>0,'playing advances clock');
test.document.hidden=true;const hiddenAt=test.evaluate('clock');api.draw();assert.equal(test.evaluate('clock'),hiddenAt,'hidden page does not advance');test.document.hidden=false;
test.evaluate('clock=17.99');test.env.deltaTime=1000;api.draw();assert.ok(Math.abs(test.evaluate('clock')-.07)<1e-9,'loop wraps and frame delta is capped');
let prevented=0;const space={code:'Space',preventDefault(){prevented++}};
test.document.listeners.keydown(space);assert.equal(test.evaluate('paused'),true,'space pauses');assert.equal(prevented,1,'space stops page scroll');
for(const tagName of ['INPUT','BUTTON','A']){test.document.activeElement={tagName};test.document.listeners.keydown(space);assert.equal(test.evaluate('paused'),true,'focused controls retain keyboard behavior')}
test.balanced();
const reduced=harness(true);reduced.api.setup();assert.equal(reduced.evaluate('paused'),true,'reduced motion starts paused');
reduced.api.draw();assert.equal(reduced.evaluate('clock'),0,'reduced motion has no automatic advance');reduced.balanced();
console.log(`通过：完整 18 秒共 1081 个采样帧，${test.calls+reduced.calls} 次绘图调用参数均有限；镜头持续跟车，小葵和汽车始终完整留在画面内，结尾也不淡出；实际车速恒定为每秒 250 像素，两轮按实际路程转动；28 只气球先向车后倾斜，再逐只松开，位置和速度连续，向左上飘离并保留完整球形；已移除彩虹；绘图状态与跳转一致；播放、暂停、重播、进度与减少动态效果逻辑通过；静态资源完整。`);
console.log('本检查不替代浏览器中的画面与实际操作验收。');
