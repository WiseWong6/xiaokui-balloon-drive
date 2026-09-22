'use strict';
// 时间是唯一运动来源；暂停、跳转和低帧率不会累积运动误差。
const W=900,H=1200,DURATION=18,BLUE='#0e3cf1',WHITE='#ffffff';
const BALLOON_COUNT=28;
const CAR_SCALE=.8;
const COLORS=['#ff6862','#ffad46','#ffe365','#68d694','#67c9ed','#758be9','#ba91df'];
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
const ease=(t,a,b)=>smooth((t-a)/(b-a));
const pt=(x,y)=>({x,y});
const blend=(a,b,t)=>pt(mix(a.x,b.x,t),mix(a.y,b.y,t));
const ground=x=>1090-6*Math.sin(Math.PI*x/W);
// 镜头与车保持同速，让整辆车始终留在画面内。
const DRIVE_SPEED=250,SCREEN_SPEED=0,START_X=470;
function driveDistance(t){return DRIVE_SPEED*t}
function carX(t){return START_X+SCREEN_SPEED*t}
function cameraTravel(t){return (DRIVE_SPEED-SCREEN_SPEED)*t}
let clock=0,paused=false,seek,playButton,phaseLabel,timeLabel,lastUI=-1;

function setup(){
  const canvas=createCanvas(W,H);canvas.parent('stage');
  pixelDensity(Math.min(window.devicePixelRatio||1,2));
  frameRate(60);strokeCap(ROUND);strokeJoin(ROUND);
  seek=document.getElementById('seek');playButton=document.getElementById('play');
  phaseLabel=document.getElementById('phase');timeLabel=document.getElementById('time');
  paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  playButton.onclick=()=>{paused=!paused;syncPlay()};
  document.getElementById('restart').onclick=()=>{clock=0;paused=false;syncPlay();updateUI(true)};
  seek.addEventListener('input',()=>{clock=clamp(Number(seek.value),0,DURATION);updateUI(true)});
  document.addEventListener('keydown',e=>{
    if(e.code==='Space'&&!['INPUT','BUTTON','A'].includes(document.activeElement.tagName)){
      e.preventDefault();paused=!paused;syncPlay();
    }
  });
  syncPlay();updateUI(true);
}
function syncPlay(){playButton.textContent=paused?'播放':'暂停';playButton.setAttribute('aria-label',paused?'播放动画':'暂停动画')}
function draw(){
  if(!paused&&!document.hidden)clock=(clock+Math.min(deltaTime,80)/1000)%DURATION;
  renderScene(clock);updateUI();
}
function updateUI(force=false){
  if(!force&&Math.floor(clock*10)===lastUI)return;lastUI=Math.floor(clock*10);
  seek.value=clock;timeLabel.textContent=`00:${String(Math.floor(clock)).padStart(2,'0')} / 00:18`;
  phaseLabel.textContent=clock<1.1?'带着气球兜风':clock<6.3?'让气球慢慢随风离开':clock<16.5?'小葵向前，气球随风':'下一次出发';
}
function vehiclePose(t){const x=carX(t),bob=Math.sin(t*9)*.7+Math.sin(t*3.2)*.45;return {x,y:ground(x)+bob,bob,angle:0}}
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
  const anchor=tether(t),r=Math.sqrt((i+.6)/BALLOON_COUNT);
  const a=i*2.39996+(variation(i+7)-.5)*.65;
  // 整簇被迎面风向左带起，绳子斜向后方；每只仍有独立轻摆。
  return pt(anchor.x-116+Math.cos(a)*94*r+(variation(i+51)-.5)*12+Math.sin(t*1.7)*6+Math.sin(t*(1.2+variation(i))+i)*3,
    anchor.y-285+Math.sin(a)*139*r+(variation(i+81)-.5)*20+Math.sin(t*.95+i*1.7)*4);
}
function attachedVelocity(i,t){
  const dt=.0001,before=attached(i,t-dt),after=attached(i,t+dt);
  return pt((after.x-before.x)/(2*dt),(after.y-before.y)/(2*dt));
}
function balloonState(i,t){
  const r=release(i);
  if(t<=r)return {p:attached(i,t),age:0,flight:0};
  const age=t-r,start=attached(i,r),velocity=attachedVelocity(i,r);
  // 向后漂移的速度换算到跟车镜头中，车与气球的相对运动保持连贯。
  const wind=SCREEN_SPEED-(108+variation(i+92)*20),rise=-68-variation(i+123)*23;
  // 松开时保留原速度，再受风与浮力影响向左上飘，位置和速度都不跳变。
  const dragX=.55,dragY=.42;
  const dx=wind*age+(velocity.x-wind)*dragX*(1-Math.exp(-age/dragX));
  const dy=rise*age+(velocity.y-rise)*dragY*(1-Math.exp(-age/dragY));
  return {p:pt(start.x+dx,start.y+dy),age,flight:1-Math.exp(-age/.8)};
}
function balloonString(i,t){
  const s=balloonState(i,t),size=balloonSize(i),tilt=balloonTilt(i,t),r=release(i);
  const tip=pt(s.p.x-Math.sin(tilt)*34*size,s.p.y+Math.cos(tilt)*34*size);
  const freeEnd=pt(s.p.x+22+Math.sin(t*1.4+i)*12,s.p.y+(100+variation(i+67)*28)*size);
  // 绳尾从车尾松开后自然垂落，不再跟着车走，也不随升空凭空消失。
  const end=t<=r?tether(t):blend(tether(r),freeEnd,ease(t,r,r+.9));
  return {tip,end,opacity:1};
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
  drawingContext.save();drawingContext.globalAlpha*=1-ease(t,16.5,18);
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
