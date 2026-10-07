'use client';
import React from 'react';
import {createPortal} from 'react-dom';

export function CalendarioPicker({value,onChange,placeholder='dd/mm/aaaa',sinBorde=false}:{value:string;onChange:(v:string)=>void;placeholder?:string;sinBorde?:boolean}){
  const F='var(--font)';
  const [abierto,setAbierto]=React.useState(false);
  const [pos,setPos]=React.useState({top:0,left:0,up:false});
  const [mesVista,setMesVista]=React.useState<Date>(()=>{if(value){const p=value.split('-');return new Date(+p[0],+p[1]-1,1);}return new Date();});
  const ref=React.useRef<HTMLDivElement>(null);
  const portalRef=React.useRef<HTMLDivElement>(null);
  React.useEffect(()=>{
    const onClick=(e:MouseEvent)=>{
      if(ref.current&&!ref.current.contains(e.target as Node)&&portalRef.current&&!portalRef.current.contains(e.target as Node))setAbierto(false);
    };
    document.addEventListener('mousedown',onClick);
    return()=>document.removeEventListener('mousedown',onClick);
  },[]);
  React.useEffect(()=>{if(value){const p=value.split('-');if(p.length===3)setMesVista(new Date(+p[0],+p[1]-1,1));}},[value]);
  const display=value?value.split('-').reverse().join('/'):'';
  const abrirCal=()=>{
    if(ref.current){const r=ref.current.getBoundingClientRect();const CAL_W=300;const left=r.left+CAL_W>window.innerWidth?r.right-CAL_W:r.left;const up=window.innerHeight-r.bottom-4<300;setPos({top:up?r.top:r.bottom+4,left:Math.max(8,left),up});}
    setAbierto(v=>!v);
  };
  return(
    <div ref={ref} style={{position:'relative',flex:sinBorde?1:undefined}}>
      <div style={{display:'flex',alignItems:'center',height:32,...(sinBorde?{}:{border:`1.5px solid ${abierto?'#1e5799':'#e2e8f0'}`,borderRadius:7}),background:'transparent',cursor:'pointer',overflow:'hidden',transition:'border-color .15s'}}
        onClick={abrirCal}>
        <span style={{flex:1,padding:'0 8px',fontSize:12,fontFamily:F,color:display?'#0f172a':'#94a3b8'}}>{display||placeholder}</span>
        <div style={{padding:'0 8px',color:abierto?'#1e5799':'#94a3b8',display:'flex',alignItems:'center',borderLeft:'1px solid #f1f5f9',height:'100%',flexShrink:0}}>
          <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" style={{width:14,height:14}}><rect x={3} y={4} width={18} height={18} rx={2}/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        </div>
      </div>
      {abierto&&(()=>{
        const ano=mesVista.getFullYear();
        const mes=mesVista.getMonth();
        const primerDia=new Date(ano,mes,1).getDay();
        const diasEnMes=new Date(ano,mes+1,0).getDate();
        const diasPrevMes=new Date(ano,mes,0).getDate();
        const today=new Date();
        const isToday=(d:number)=>d===today.getDate()&&mes===today.getMonth()&&ano===today.getFullYear();
        const isSel=(d:number)=>{if(!value)return false;const p=value.split('-');return +p[0]===ano&&+p[1]-1===mes&&+p[2]===d;};
        const DIAS=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
        const MESES_ES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const pascua=(y:number)=>{const a=y%19,b=Math.floor(y/100),c2=y%100,d2=Math.floor(b/4),e2=b%4,f2=Math.floor((b+8)/25),g2=Math.floor((b-f2+1)/3),h2=(19*a+b-d2-g2+15)%30,i2=Math.floor(c2/4),k2=c2%4,l2=(32+2*e2+2*i2-h2-k2)%7,m2=Math.floor((a+11*h2+22*l2)/451),mo=Math.floor((h2+l2-7*m2+114)/31)-1,da=((h2+l2-7*m2+114)%31)+1;return new Date(y,mo,da);};
        const lunSig=(dt:Date)=>{const d2=new Date(dt),dw=d2.getDay();if(dw===1)return d2;d2.setDate(d2.getDate()+(dw===0?1:8-dw));return d2;};
        const festivos=(y:number):Date[]=>{
          const P=pascua(y);const add=(m:number,d:number)=>new Date(y,m,d);const pu=(m:number,d:number)=>lunSig(new Date(y,m,d));
          return[add(0,1),pu(0,6),pu(2,19),new Date(P.getTime()-3*864e5),new Date(P.getTime()-2*864e5),add(4,1),lunSig(new Date(P.getTime()+39*864e5)),lunSig(new Date(P.getTime()+60*864e5)),lunSig(new Date(P.getTime()+68*864e5)),pu(5,29),add(6,20),add(7,7),pu(7,15),pu(9,12),pu(10,1),pu(10,11),add(11,8),add(11,25)];
        };
        const festAno=festivos(ano);
        const esFestivo=(d2:number)=>festAno.some(f=>f.getFullYear()===ano&&f.getMonth()===mes&&f.getDate()===d2);
        const cells:{d:number;off:number}[]=[];
        for(let i=primerDia-1;i>=0;i--)cells.push({d:diasPrevMes-i,off:-1});
        for(let i=1;i<=diasEnMes;i++)cells.push({d:i,off:0});
        let nx=1;while(cells.length%7!==0)cells.push({d:nx++,off:1});
        const toStr=(d:number)=>`${ano}-${String(mes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        return createPortal(
          <div ref={portalRef} style={{position:'fixed',...(pos.up?{bottom:window.innerHeight-pos.top+4}:{top:pos.top}),left:pos.left,zIndex:9999,background:'#fff',borderRadius:18,boxShadow:'0 8px 32px rgba(0,0,0,.14)',border:'1px solid #e8e6e0',padding:'18px 16px',width:300,userSelect:'none'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
              <button onClick={e=>{e.stopPropagation();setMesVista(new Date(ano,mes-1,1));}} style={{width:30,height:30,borderRadius:'50%',border:'1px solid #e8e6e0',background:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,color:'#6f6c66'}}>{'‹'}</button>
              <span style={{fontSize:14,fontWeight:700,color:'#161412',fontFamily:F}}>{MESES_ES[mes]} {ano}</span>
              <button onClick={e=>{e.stopPropagation();setMesVista(new Date(ano,mes+1,1));}} style={{width:30,height:30,borderRadius:'50%',border:'1px solid #e8e6e0',background:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,color:'#6f6c66'}}>{'›'}</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',marginBottom:6}}>
              {DIAS.map(d=>(<div key={d} style={{textAlign:'center',fontSize:10,fontWeight:700,color:'#a8a49c',fontFamily:F,paddingBottom:6}}>{d}</div>))}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
              {cells.map((ce,i)=>{
                const esHoy=ce.off===0&&isToday(ce.d);
                const esSel=ce.off===0&&isSel(ce.d);
                const esCurMes=ce.off===0;
                const esFest=esCurMes&&esFestivo(ce.d);
                return(
                  <div key={i} onClick={()=>{if(esCurMes){onChange(toStr(ce.d));setAbierto(false);}}}
                    style={{height:34,display:'flex',alignItems:'center',justifyContent:'center',
                      borderRadius:8,fontSize:12,fontWeight:esSel||esHoy||esFest?700:400,fontFamily:F,
                      cursor:esCurMes?'pointer':'default',
                      color:esSel?'#fff':esHoy?'#0ea5e9':!esCurMes?'#d1cfc9':esFest?'#dd5433':'#161412',
                      background:esSel?'#161412':esHoy?'#e0f5ff':esFest?'#fff3f0':'transparent',
                      transition:'background .1s'}}
                    onMouseEnter={e=>{if(esCurMes&&!esSel&&!esHoy)(e.currentTarget as HTMLDivElement).style.background=esFest?'#ffe4de':'#f5f4f1';}}
                    onMouseLeave={e=>{if(esCurMes&&!esSel&&!esHoy)(e.currentTarget as HTMLDivElement).style.background=esFest?'#fff3f0':'transparent';}}>
                    {ce.d}
                  </div>
                );
              })}
            </div>
            {value&&(
              <div style={{borderTop:'1px solid #f0efec',marginTop:12,paddingTop:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:11,color:'#a8a49c',fontFamily:F}}><b style={{color:'#161412'}}>{display}</b></span>
                <button onClick={e=>{e.stopPropagation();onChange('');setAbierto(false);}} style={{fontSize:10,color:'#1e3a8a',border:'none',background:'none',cursor:'pointer',fontFamily:F,fontWeight:600}}>Limpiar</button>
              </div>
            )}
          </div>
        ,document.body);
      })()}
    </div>
  );
}
export default CalendarioPicker;