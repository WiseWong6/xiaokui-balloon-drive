'use strict';
// 时间是唯一运动来源；暂停、跳转和低帧率不会累积运动误差。
const W=900,H=1200,DURATION=14,BLUE='#0e3cf1',WHITE='#ffffff';
const BALLOON_COUNT=35;
const CAR_SCALE=.64;
const COLORS=['#ff6862','#ffad46','#ffe365','#68d694','#67c9ed','#758be9','#ba91df'];
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
const ease=(t,a,b)=>smooth((t-a)/(b-a));
const pt=(x,y)=>({x,y});
const blend=(a,b,t)=>pt(mix(a.x,b.x,t),mix(a.y,b.y,t));
const ground=x=>1090-6*Math.sin(Math.PI*x/W);
// 先跟车；气球清空后镜头逐渐落后，汽车仍保持同一实际速度。
const DRIVE_SPEED=360,DEPART_SCREEN_SPEED=210,START_X=470,CAMERA_RELEASE_SECONDS=.7;
function driveDistance(t){return DRIVE_SPEED*t}
function cameraLag(t){
  const elapsed=Math.max(0,t-DEPART_AT),u=clamp(elapsed/CAMERA_RELEASE_SECONDS);
  // 平滑增加车在画面中的速度，积分后使位置与速度都连续。
  return DEPART_SCREEN_SPEED*(elapsed<CAMERA_RELEASE_SECONDS
    ?CAMERA_RELEASE_SECONDS*(u*u*u-.5*u*u*u*u):elapsed-CAMERA_RELEASE_SECONDS/2);
}
function carX(t){return START_X+cameraLag(t)}
function cameraTravel(t){return driveDistance(t)-cameraLag(t)}
let clock=0,paused=false,playbackRate=1,draggingProgress=false;
let seek,playButton,timeLabel,speedButton,soundButton,sceneSound,lastUI=-1;

function setup(){
  const canvas=createCanvas(W,H);canvas.parent('stage');
  pixelDensity(Math.min(window.devicePixelRatio||1,2));
  frameRate(60);strokeCap(ROUND);strokeJoin(ROUND);
  seek=document.getElementById('play-progress');playButton=document.getElementById('play-toggle');
  timeLabel=document.getElementById('play-time');speedButton=document.getElementById('play-speed');
  soundButton=document.getElementById('play-sound');
  const restart=document.getElementById('play-restart');
  for(const control of [seek,playButton,speedButton,soundButton,restart])control.disabled=false;
  paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  sceneSound=new DrivingSound(Array.from({length:BALLOON_COUNT},(_,index)=>({
    time:release(index),index,x:tether(release(index)).x/W*2-1
  })));
  sceneSound.getFrame=soundFrame;
  sceneSound.onError=error=>syncSoundButton(error);
  playButton.onclick=()=>{paused=!paused;syncPlay();updateSound()};
  restart.onclick=()=>{
    clock=0;paused=false;sceneSound.invalidate();syncPlay();updateUI(true);updateSound();
  };
  speedButton.onclick=()=>{
    const rates=[.5,1,1.5,2,3];
    playbackRate=rates[(rates.indexOf(playbackRate)+1)%rates.length];
    sceneSound.invalidate();updateUI(true);updateSound();
  };
  soundButton.onclick=async()=>{
    soundButton.disabled=true;
    try{await sceneSound.setEnabled(!sceneSound.enabled);syncSoundButton();updateSound()}
    catch(error){syncSoundButton(error)}
    finally{soundButton.disabled=false}
  };
  seek.addEventListener('pointerdown',()=>{draggingProgress=true;updateSound()});
  seek.addEventListener('input',()=>{
    const value=Number(seek.value);
    if(!Number.isFinite(value))return;
    clock=clamp(value,0,DURATION);sceneSound.invalidate();updateUI(true);updateSound();
  });
  const finishDrag=()=>{if(draggingProgress){draggingProgress=false;updateSound()}};
  for(const event of ['pointerup','pointercancel','blur'])window.addEventListener(event,finishDrag);
  document.addEventListener('keydown',e=>{
    if(e.code==='Space'&&!e.repeat&&!['INPUT','BUTTON','A'].includes(document.activeElement.tagName)){
      e.preventDefault();paused=!paused;syncPlay();updateSound();
    }
  });
  document.addEventListener('visibilitychange',()=>{
    sceneSound.invalidate();updateSound();
  });
  window.addEventListener('pagehide',()=>sceneSound.silence());
  window.addEventListener('pageshow',()=>{sceneSound.invalidate();updateSound()});
  setupControlsVisibility();syncPlay();syncSoundButton();updateUI(true);updateSound();
}
function syncPlay(){
  playButton.textContent=paused?'播放':'暂停';
  playButton.setAttribute('aria-label',paused?'播放动画':'暂停动画');
}
function syncSoundButton(error){
  soundButton.textContent=error?'音效重试':sceneSound.enabled?'声音开':'声音关';
  soundButton.setAttribute('aria-pressed',String(sceneSound.enabled));
  soundButton.setAttribute('aria-label',error?'重试开启音效':sceneSound.enabled?'关闭音效':'开启音效');
  soundButton.title=error?error.message:'开启行驶、风声与气球松绳音效';
}
function soundFrame(){
  return {time:clock,duration:DURATION,rate:playbackRate,running:!paused&&!draggingProgress&&!document.hidden,
    vehicleGain:1-ease(carX(clock),W-120,W+180),vehiclePan:clamp(carX(clock)/W*2-1,-1,1)};
}
function updateSound(){sceneSound.update(soundFrame())}
function setupControlsVisibility(){
  const controls=document.getElementById('play-controls');
  const reveal=()=>controls.classList.remove('is-hidden');
  controls.addEventListener('focusin',reveal);
  window.addEventListener('pointerdown',reveal,{passive:true});
  window.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse')return;
    const bounds=controls.getBoundingClientRect();
    const near=event.clientX>=bounds.left-16&&event.clientX<=bounds.right+16&&event.clientY>=bounds.top-16;
    if(near||draggingProgress||controls.contains(document.activeElement))reveal();
    else controls.classList.add('is-hidden');
  },{passive:true});
}
function draw(){
  if(!paused&&!draggingProgress&&!document.hidden){
    const next=clock+Math.min(deltaTime,80)/1000*playbackRate;
    if(next>=DURATION)sceneSound.invalidate();
    clock=next%DURATION;
  }
  renderScene(clock);updateUI();updateSound();
}
function clockText(value){return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(Math.floor(value%60)).padStart(2,'0')}`}
function updateUI(force=false){
  if(!force&&Math.floor(clock*10)===lastUI)return;lastUI=Math.floor(clock*10);
  if(!draggingProgress||force)seek.value=clock;
  seek.style.setProperty('--progress',`${clock/DURATION*100}%`);
  seek.setAttribute('aria-valuetext',`${clockText(clock)}，共 ${clockText(DURATION)}`);
  timeLabel.textContent=`${clockText(clock/playbackRate)} / ${clockText(DURATION/playbackRate)}`;
  speedButton.textContent=`${playbackRate}×`;
  speedButton.setAttribute('aria-label',`播放速度 ${playbackRate} 倍，点击切换`);
}
function vehicleBob(t){return Math.sin(t*9)*.7+Math.sin(t*3.2)*.45}
function vehiclePose(t){const x=carX(t),bob=vehicleBob(t);return {x,y:ground(x)+bob,bob,angle:0}}
function trackedTether(t){return pt(START_X-152*CAR_SCALE,ground(START_X)+vehicleBob(t)-177*CAR_SCALE)}
function world(t,p){const car=vehiclePose(t);return pt(car.x+p.x*CAR_SCALE,car.y+p.y*CAR_SCALE)}
function tether(t){return world(t,pt(-152,-177))}
function release(i){return 1.1+Math.floor(i/7)*1.5+(i%7)*.105}
const variation=i=>{const v=Math.sin(i*127.1+311.7)*43758.5453;return v-Math.floor(v)};
const balloonSize=i=>.76+variation(i+41)*.45;
function attachedTilt(i,t){return -.38+(variation(i+19)-.5)*.22+Math.sin(t*1.3+i)*.055}
function balloonTilt(i,t){
  const r=release(i);
  if(t<=r)return attachedTilt(i,t);
  const free=-.13+Math.sin(t*1.15+i)*.13;
  return mix(attachedTilt(i,r),free,ease(t,r,r+1.6));
}
function attached(i,t){
  const anchor=trackedTether(t),r=Math.sqrt((i+.6)/BALLOON_COUNT);
  const a=i*2.39996+(variation(i+7)-.5)*.65;
  // 整簇被迎面风向左带起，绳子斜向后方；每只仍有独立轻摆。
  return pt(anchor.x-116+Math.cos(a)*94*r+(variation(i+51)-.5)*12+Math.sin(t*1.7)*6+Math.sin(t*(1.2+variation(i))+i)*3,
    anchor.y-285+Math.sin(a)*139*r+(variation(i+81)-.5)*20+Math.sin(t*.95+i*1.7)*4);
}
function attachedVelocity(i,t){
  const dt=.0001,before=attached(i,t-dt),after=attached(i,t+dt);
  return pt((after.x-before.x)/(2*dt),(after.y-before.y)/(2*dt));
}
function trackedBalloonState(i,t){
  const r=release(i);
  if(t<=r)return {p:attached(i,t),age:0,flight:0};
  const age=t-r,start=attached(i,r),velocity=attachedVelocity(i,r);
  // 向后漂移的速度换算到跟车镜头中，车与气球的相对运动保持连贯。
  const wind=-(DRIVE_SPEED*.6+variation(i+92)*32),rise=-68-variation(i+123)*23;
  // 松开时保留原速度，再受风与浮力影响向左上飘，位置和速度都不跳变。
  const dragX=.55,dragY=.42;
  const dx=wind*age+(velocity.x-wind)*dragX*(1-Math.exp(-age/dragX));
  const dy=rise*age+(velocity.y-rise)*dragY*(1-Math.exp(-age/dragY));
  return {p:pt(start.x+dx,start.y+dy),age,flight:1-Math.exp(-age/.8)};
}
function trackedBalloonString(i,t){
  const s=trackedBalloonState(i,t),size=balloonSize(i),tilt=balloonTilt(i,t),r=release(i);
  const tip=pt(s.p.x-Math.sin(tilt)*34*size,s.p.y+Math.cos(tilt)*34*size);
  const freeEnd=pt(s.p.x+22+Math.sin(t*1.4+i)*12,s.p.y+(100+variation(i+67)*28)*size);
  // 绳尾从车尾松开后自然垂落，不再跟着车走，也不随升空凭空消失。
  const end=t<=r?trackedTether(t):blend(trackedTether(r),freeEnd,ease(t,r,r+.9));
  return {tip,end,opacity:1};
}
// 球体用保守外接半径，绳子用曲线控制点边界，连描边也完全离开才放车走。
function trackedBalloonRightEdge(i,t){
  const {p}=trackedBalloonState(i,t),string=trackedBalloonString(i,t);
  return Math.max(p.x+40*balloonSize(i),string.tip.x+10,string.end.x)+2;
}
function findDepartureTime(){
  const lastRelease=release(BALLOON_COUNT-1);
  for(let frame=0;frame<Math.ceil((DURATION-lastRelease)*120);frame++){
    const t=lastRelease+frame/120;
    if(Array.from({length:BALLOON_COUNT},(_,i)=>trackedBalloonRightEdge(i,t)).every(x=>x<-8))return t;
  }
  return DURATION;
}
const DEPART_AT=findDepartureTime();
function balloonState(i,t){
  const state=trackedBalloonState(i,t);
  return {...state,p:pt(state.p.x+cameraLag(t),state.p.y)};
}
function balloonString(i,t){
  const string=trackedBalloonString(i,t),dx=cameraLag(t);
  return {...string,tip:pt(string.tip.x+dx,string.tip.y),end:pt(string.end.x+dx,string.end.y)};
}
function renderScene(t){
  background(BLUE);
  noStroke();fill('#1340e7');beginShape();vertex(-20,H);
  for(let x=-20;x<=W+20;x+=10)vertex(x,ground(x)+1);
  vertex(W+20,H);endShape(CLOSE);
  // 路面标记随镜头向后退，给出明确车速；不增加额外风景。
  noFill();stroke('#4272f4');strokeWeight(2.2);
  const offset=((cameraTravel(t)%160)+160)%160;
  for(let k=-1;k<8;k++){
    const x=k*160-offset;line(x,1132,x+38,1132);
    line(x+92,1176,x+113,1176);
  }
  drawingContext.save();
  for(let i=BALLOON_COUNT-1;i>=0;i--)drawBalloon(i,t,'strings');
  for(let i=BALLOON_COUNT-1;i>=0;i--)drawBalloon(i,t,'body');
  if(t<release(BALLOON_COUNT-1)){
    const anchor=tether(t);noStroke();fill('#ffe365');circle(anchor.x,anchor.y,7);
  }
  drawingContext.restore();
  const car=vehiclePose(t);push();translate(car.x,car.y);scale(CAR_SCALE);
  // 猫与车统一缩小，绳锚点同步；轮胎按缩小后的半径计算滚动。
  drawXiaokuiCar(t,driveDistance(t)/CAR_SCALE);pop();
}
function drawBalloon(i,t,layer='both'){
  const s=balloonState(i,t),p=s.p,color=COLORS[i%7];
  if(layer!=='body'){
    const string=balloonString(i,t),from=string.end,to=string.tip;
    noFill();stroke(255,255,255,178);strokeWeight(.95);
    bezier(from.x,from.y,from.x-20,from.y+(to.y-from.y)*.36,to.x+10,to.y-(to.y-from.y)*.27,to.x,to.y);
  }
  if(layer==='strings')return;
  // 始终保留完整球形、结口和反光，只随风离开画面。
  const size=balloonSize(i),tilt=balloonTilt(i,t),rx=26*size,ry=34*size;
  push();translate(p.x,p.y);rotate(tilt);
  noStroke();fill(color);
  const g=drawingContext.createRadialGradient(-rx*.35,-ry*.48,1,0,0,ry*1.25);
  g.addColorStop(0,tintHex(color,.16));g.addColorStop(.65,color);g.addColorStop(1,tintHex(color,-.04));
  drawingContext.fillStyle=g;
  beginShape();for(let j=0;j<96;j++){
    const q=j/96*Math.PI*2;vertex(Math.cos(q)*rx*(1-.14*Math.sin(q)),Math.sin(q)*ry);
  }endShape(CLOSE);
  fill(color);triangle(0,ry-1,-3*size,ry+3*size,4*size,ry+3*size);
  push();translate(-rx*.35,-ry*.53);rotate(-.5);
  fill(255,255,255,155);ellipse(0,0,6*size,12*size);pop();pop();
}
function tintHex(hex,k){
  const a=[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16));
  return '#'+a.map(v=>Math.round(k>=0?mix(v,255,k):v*(1+k)).toString(16).padStart(2,'0')).join('');
}
