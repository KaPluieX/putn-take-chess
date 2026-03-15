// ── Put'N Take Chess — AI Web Worker ──────────────────────
// All engine code runs here off the main thread so the UI never freezes.

const PV={P:100,N:320,B:330,R:500,Q:900,K:20000};
const PST={
  P:[0,0,0,0,0,0,0,0,50,50,50,50,50,50,50,50,10,10,20,30,30,20,10,10,5,5,10,25,25,10,5,5,0,0,0,20,20,0,0,0,5,-5,-10,0,0,-10,-5,5,5,10,10,-20,-20,10,10,5,0,0,0,0,0,0,0,0],
  N:[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
  B:[-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20],
  R:[0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0],
  Q:[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
  K:[-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20]
};
const RHINO_VAL=1500;

let VARIANT='putn-take';
let SETTINGS={tripleMove:false};
function hasRhino(){return VARIANT==='rhino'||VARIANT==='rhino-putn';}
function hasPutnTake(){return VARIANT==='putn-take'||VARIANT==='rhino-putn';}

function rk(s){return Math.floor(s/8);}
function fl(s){return s%8;}
function sq(r,f){return r*8+f;}
function opp(c){return c==='w'?'b':'w';}

function rhinoReach(board,fromSq,color){
  const en=opp(color),DIRS=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const reachable=new Set([fromSq]),queue=[fromSq],caps=new Set();
  while(queue.length){
    const pos=queue.shift(),ri=rk(pos),fi=fl(pos);
    for(const[dr,dc]of DIRS){
      let cr=ri+dr,cf=fi+dc;
      while(cr>=0&&cr<=7&&cf>=0&&cf<=7){
        const s=sq(cr,cf),p=board[s];
        if(p){if(p[0]===en&&p[1]!=='Q')caps.add(s);break;}
        if(!reachable.has(s)){reachable.add(s);queue.push(s);}
        cr+=dr;cf+=dc;
      }
    }
  }
  reachable.delete(fromSq);
  return{moves:[...reachable],caps:[...caps]};
}

function isAttacked(board,square,byColor){
  const ri=rk(square),fi=fl(square),e=byColor;
  for(const[dr,df]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){
    const nr=ri+dr,nf=fi+df;if(nr>=0&&nr<=7&&nf>=0&&nf<=7&&board[sq(nr,nf)]===e+'N')return true;
  }
  for(const[dr,df]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]){
    const nr=ri+dr,nf=fi+df;if(nr>=0&&nr<=7&&nf>=0&&nf<=7&&board[sq(nr,nf)]===e+'K')return true;
  }
  const pd=e==='w'?-1:1;
  for(const df of[-1,1]){const nr=ri+pd,nf=fi+df;if(nr>=0&&nr<=7&&nf>=0&&nf<=7&&board[sq(nr,nf)]===e+'P')return true;}
  for(const[dr,df]of[[-1,-1],[-1,1],[1,-1],[1,1]]){let cr=ri+dr,cf=fi+df;while(cr>=0&&cr<=7&&cf>=0&&cf<=7){const p=board[sq(cr,cf)];if(p){if(p[0]===e&&(p[1]==='B'||p[1]==='Q'))return true;break;}cr+=dr;cf+=df;}}
  for(const[dr,df]of[[-1,0],[1,0],[0,-1],[0,1]]){let cr=ri+dr,cf=fi+df;while(cr>=0&&cr<=7&&cf>=0&&cf<=7){const p=board[sq(cr,cf)];if(p){if(p[0]===e&&(p[1]==='R'||p[1]==='Q'))return true;break;}cr+=dr;cf+=df;}}
  return false;
}

function pseudoMoves(board,color,castling,ep){
  const moves=[],en=opp(color);
  for(let from=0;from<64;from++){
    const p=board[from];if(!p||p[0]!==color)continue;
    const t=p[1],ri=rk(from),fi=fl(from);
    if(t==='P'){
      const d=color==='w'?1:-1,sr=color==='w'?1:6,pr=color==='w'?7:0,br=color==='w'?0:7,fwd=from+d*8;
      if(fwd>=0&&fwd<64&&!board[fwd]){
        if(rk(fwd)===pr){for(const pp of['Q','R','B','N'])moves.push({from,to:fwd,promotion:pp});}
        else{
          moves.push({from,to:fwd});
          if((ri===sr||(SETTINGS.tripleMove&&hasPutnTake()&&ri===br))&&!board[from+d*16])moves.push({from,to:from+d*16,dp:true});
          if(SETTINGS.tripleMove&&hasPutnTake()&&ri===br){
            const s2=from+d*16,s3=from+d*24;
            if(s3>=0&&s3<64&&!board[s2]&&!board[s3])moves.push({from,to:s3,tp:true});
          }
        }
      }
      const epSqs=ep===null?[]:(typeof ep==='object'&&ep.squares?ep.squares:[ep]);
      const epPSq=ep!==null&&typeof ep==='object'&&ep.pawnSq!=null?ep.pawnSq:null;
      for(const df of[-1,1]){
        const tf=fi+df;if(tf<0||tf>7)continue;
        const to=from+d*8+df;if(to<0||to>63)continue;
        if(board[to]&&board[to][0]===en){
          if(rk(to)===pr){for(const pp of['Q','R','B','N'])moves.push({from,to,cap:board[to],promotion:pp});}
          else moves.push({from,to,cap:board[to]});
        } else if(epSqs.includes(to)){
          const remSq=epPSq!==null?epPSq:to+(color==='w'?-8:8);
          moves.push({from,to,cap:color==='w'?'bP':'wP',ep:true,epRemoveSq:remSq});
        }
      }
    } else if(t==='N'){
      for(const[dr,df]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){
        const nr=ri+dr,nf=fi+df;if(nr<0||nr>7||nf<0||nf>7)continue;
        const to=sq(nr,nf);if(!board[to]||board[to][0]===en)moves.push({from,to,cap:board[to]||null});
      }
    } else if(t==='K'){
      for(const[dr,df]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]){
        const nr=ri+dr,nf=fi+df;if(nr<0||nr>7||nf<0||nf>7)continue;
        const to=sq(nr,nf);if(!board[to]||board[to][0]===en)moves.push({from,to,cap:board[to]||null});
      }
      if(color==='w'&&ri===0&&fi===4){
        if(castling.wK&&!board[5]&&!board[6]&&board[7]==='wR')moves.push({from,to:6,castle:'K'});
        if(castling.wQ&&!board[1]&&!board[2]&&!board[3]&&board[0]==='wR')moves.push({from,to:2,castle:'Q'});
      }
      if(color==='b'&&ri===7&&fi===4){
        if(castling.bK&&!board[61]&&!board[62]&&board[63]==='bR')moves.push({from,to:62,castle:'K'});
        if(castling.bQ&&!board[57]&&!board[58]&&!board[59]&&board[56]==='bR')moves.push({from,to:58,castle:'Q'});
      }
    } else if(t==='Q'&&hasRhino()){
      const{moves:rm,caps:rc}=rhinoReach(board,from,color);
      for(const to of rm)moves.push({from,to,cap:null});
      for(const to of rc)moves.push({from,to,cap:board[to]});
    } else {
      const dirs=t==='B'?[[-1,-1],[-1,1],[1,-1],[1,1]]:t==='R'?[[-1,0],[1,0],[0,-1],[0,1]]:[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
      for(const[dr,df]of dirs){
        let cr=ri+dr,cf=fi+df;
        while(cr>=0&&cr<=7&&cf>=0&&cf<=7){
          const to=sq(cr,cf);
          if(!board[to])moves.push({from,to,cap:null});
          else if(board[to][0]===en){moves.push({from,to,cap:board[to]});break;}
          else break;
          cr+=dr;cf+=df;
        }
      }
    }
  }
  return moves;
}

function applyMove(board,move,castling,ep){
  const b=[...board],nc={...castling};let nep=null;
  const p=b[move.from],c=p[0],t=p[1];
  b[move.to]=move.promotion?c+move.promotion:p;b[move.from]=null;
  if(move.ep)b[move.epRemoveSq!==undefined?move.epRemoveSq:move.to+(c==='w'?-8:8)]=null;
  if(move.dp)nep=c==='w'?move.from+8:move.from-8;
  if(move.tp)nep={squares:[c==='w'?move.from+8:move.from-8,c==='w'?move.from+16:move.from-16],pawnSq:move.to};
  if(move.castle==='K'){c==='w'?(b[5]='wR',b[7]=null):(b[61]='bR',b[63]=null);}
  if(move.castle==='Q'){c==='w'?(b[3]='wR',b[0]=null):(b[59]='bR',b[56]=null);}
  if(t==='K'){c==='w'?(nc.wK=false,nc.wQ=false):(nc.bK=false,nc.bQ=false);}
  if(move.from===0||move.to===0)nc.wQ=false;if(move.from===7||move.to===7)nc.wK=false;
  if(move.from===56||move.to===56)nc.bQ=false;if(move.from===63||move.to===63)nc.bK=false;
  return{board:b,castling:nc,ep:nep};
}

function isInCheck(board,color){
  const ks=board.findIndex(p=>p===color+'K');
  if(ks===-1)return false;
  if(isAttacked(board,ks,opp(color)))return true;
  if(hasRhino()){
    const en=opp(color);
    for(let i=0;i<64;i++){
      if(board[i]===en+'Q'){const{caps}=rhinoReach(board,i,en);if(caps.includes(ks))return true;}
    }
  }
  return false;
}

function legalMoves(board,color,castling,ep){
  return pseudoMoves(board,color,castling,ep).filter(m=>{
    if(m.castle==='K'){if(isAttacked(board,m.from,opp(color))||isAttacked(board,m.from+1,opp(color)))return false;}
    if(m.castle==='Q'){if(isAttacked(board,m.from,opp(color))||isAttacked(board,m.from-1,opp(color)))return false;}
    return!isInCheck(applyMove(board,m,castling,ep).board,color);
  });
}

function genSuperMoves(board,color,castling,ep){
  const base=legalMoves(board,color,castling,ep),res=[];
  for(const m of base){
    if(m.cap){
      const{board:nb}=applyMove(board,m,castling,ep);
      let added=false;
      for(let s=0;s<64;s++){
        if(nb[s])continue;
        let pl=m.cap;
        if(pl[1]==='P'){const r=rk(s);if((pl[0]==='w'&&r===7)||(pl[0]==='b'&&r===0))pl=pl[0]+'Q';}
        const tb=[...nb];tb[s]=pl;
        if(isInCheck(tb,color))continue;
        res.push({...m,placeSq:s});added=true;
      }
      if(!added)res.push(m);
    } else res.push(m);
  }
  return res;
}

function applySM(board,move,castling,ep){
  const res=applyMove(board,move,castling,ep);
  if(move.placeSq!==undefined&&move.cap){
    let pl=move.cap;
    if(pl[1]==='P'){const r=rk(move.placeSq);if((pl[0]==='w'&&r===7)||(pl[0]==='b'&&r===0))pl=pl[0]+'Q';}
    res.board[move.placeSq]=pl;
  }
  return res;
}

function evaluate(board){
  let s=0;
  for(let i=0;i<64;i++){
    const p=board[i];if(!p)continue;
    const c=p[0],t=p[1],pstIdx=c==='w'?i:(7-rk(i))*8+fl(i);
    const matVal=(hasRhino()&&t==='Q')?RHINO_VAL:PV[t];
    s+=c==='w'?matVal+(PST[t]?PST[t][pstIdx]:0)*3:-(matVal+(PST[t]?PST[t][pstIdx]:0)*3);
  }
  // In Put'N Take, a promoted queen NEVER leaves the board — permanent material.
  // A pawn near promotion is worth far more than standard PST suggests.
  // Bonus: 1 away = 700pts, 2 away = 350pts (scaled like a certain queen gain).
  if(hasPutnTake()){
    for(let i=0;i<64;i++){
      const p=board[i];if(!p||p[1]!=='P')continue;
      const c=p[0],rank=rk(i);
      const distToPromo=c==='w'?7-rank:rank;
      const bonus=distToPromo===1?700:distToPromo===2?350:0;
      if(bonus)s+=c==='w'?bonus:-bonus;
    }
  }
  return s;
}

function displPot(board,move){
  if(!move.cap)return-999;
  const cap=move.cap,pt=cap[1],pc=cap[0],capSq=move.to;
  const ci=pc==='w'?capSq:(7-rk(capSq))*8+fl(capSq);
  const cur=PST[pt]?PST[pt][ci]:0;
  const{board:nb}=applyMove(board,move,{wK:true,wQ:true,bK:true,bQ:true},null);
  let mn=Infinity;
  for(let s=0;s<64;s++){if(nb[s])continue;const idx=pc==='w'?s:(7-rk(s))*8+fl(s);const v=PST[pt]?PST[pt][idx]:0;if(v<mn)mn=v;}
  return cur-(mn===Infinity?0:mn);
}

let gDeadline=Infinity,gTimeUp=false;

function minimax(board,depth,alpha,beta,maximize,color,castling,ep){
  if(gTimeUp)return 0;
  const moves=hasPutnTake()?genSuperMoves(board,color,castling,ep):legalMoves(board,color,castling,ep);
  if(!moves.length)return isInCheck(board,color)?(maximize?-50000:50000):0;
  if(!depth){if(Date.now()>gDeadline)gTimeUp=true;return evaluate(board);}
  let best=maximize?-Infinity:Infinity;
  for(const m of moves){
    if(gTimeUp)break;
    const{board:nb,castling:nc,ep:nep}=applySM(board,m,castling,ep);
    const s=minimax(nb,depth-1,alpha,beta,!maximize,opp(color),nc,nep);
    if(maximize){best=Math.max(best,s);alpha=Math.max(alpha,s);}
    else{best=Math.min(best,s);beta=Math.min(beta,s);}
    if(beta<=alpha)break;
  }
  return best;
}

function getBestMove(board,color,castling,ep,depth){
  const moves=hasPutnTake()?genSuperMoves(board,color,castling,ep):legalMoves(board,color,castling,ep);
  if(!moves.length)return null;
  moves.sort(()=>Math.random()-.5);
  moves.sort((a,b)=>displPot(board,b)-displPot(board,a));
  let best=color==='w'?-Infinity:Infinity,bm=moves[0];
  for(const m of moves){
    if(gTimeUp)break;
    const{board:nb,castling:nc,ep:nep}=applySM(board,m,castling,ep);
    const s=minimax(nb,depth-1,-Infinity,Infinity,color==='b',opp(color),nc,nep);
    if(color==='w'?s>best:s<best){best=s;bm=m;}
  }
  return bm;
}

// ── Message handler ────────────────────────────────────────
self.onmessage=function(e){
  const{board,color,castling,ep,depth,thinkMs,variant,settings,jobId}=e.data;
  VARIANT=variant;
  if(settings)SETTINGS={...SETTINGS,...settings};
  const ms=thinkMs===0?Infinity:thinkMs;
  gDeadline=ms===Infinity?Infinity:Date.now()+ms;
  gTimeUp=false;
  const move=getBestMove(board,color,castling,ep,depth);
  self.postMessage({move,jobId});
};
