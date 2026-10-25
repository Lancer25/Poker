(function (root) {
  const themes = [
    {id:'fresh',label:'清新牌室',dark:false,tokens:{
      '--page-bg':'#edf1f1','--surface':'#fbfcfd','--surface-2':'#e6ebed','--ink':'#25343d','--muted':'#62747b',
      '--line':'#cbd5d8','--accent':'#058a79','--accent-ink':'#ffffff','--gold':'#b0791a','--gold-strong':'#f1d285',
      '--table-image':'url("/assets/themes/tables-portrait-v2.webp")','--table-size':'300% 100%','--table-ratio':'.75',
      '--table-wide-image':'url("/assets/themes/tables-wide-v2.webp")','--table-wide-size':'100% 300%','--table-wide-y':'0%','--table-wide-ratio':'2','--chip-image':'url("/assets/themes/chips-v1.webp")',
      '--table-x':'0%','--icon-filter':'none','--table-ink':'#f6fff8','--seat-bg':'#083c36d9','--card-back':'#245873',
      '--negative':'#c34f56','--positive':'#08745e','--input-bg':'#ffffff','--focus':'#00816f','--shadow':'#172d3d20'}},
    {id:'classic',label:'经典牌室',dark:true,tokens:{
      '--page-bg':'#19191b','--surface':'#242427','--surface-2':'#303033','--ink':'#f3f1ec','--muted':'#b6b4ad',
      '--line':'#4b4643','--accent':'#128e7d','--accent-ink':'#ffffff','--gold':'#e8c97f','--gold-strong':'#efd18c',
      '--table-image':'url("/assets/themes/tables-portrait-v2.webp")','--table-size':'300% 100%','--table-ratio':'.75',
      '--table-wide-image':'url("/assets/themes/tables-wide-v2.webp")','--table-wide-size':'100% 300%','--table-wide-y':'50%','--table-wide-ratio':'2','--chip-image':'url("/assets/themes/chips-v1.webp")',
      '--table-x':'50%','--icon-filter':'invert(1)','--table-ink':'#fff7e5','--seat-bg':'#24171dda','--card-back':'#303e59',
      '--negative':'#f08083','--positive':'#84d9b2','--input-bg':'#1c1c20','--focus':'#e9ca82','--shadow':'#00000055'}},
    {id:'arena',label:'竞技牌室',dark:true,tokens:{
      '--page-bg':'#151a1c','--surface':'#222a2d','--surface-2':'#303b3f','--ink':'#f1f7f6','--muted':'#b0c2c3',
      '--line':'#435359','--accent':'#32c7a7','--accent-ink':'#10231f','--gold':'#b6e5d4','--gold-strong':'#b6e5d4',
      '--table-image':'url("/assets/themes/tables-portrait-v2.webp")','--table-size':'300% 100%','--table-ratio':'.75',
      '--table-wide-image':'url("/assets/themes/tables-wide-v2.webp")','--table-wide-size':'100% 300%','--table-wide-y':'100%','--table-wide-ratio':'2','--chip-image':'url("/assets/themes/chips-v1.webp")',
      '--table-x':'100%','--icon-filter':'invert(1)','--table-ink':'#f0faf7','--seat-bg':'#182d2de8','--card-back':'#305b55',
      '--negative':'#fa9095','--positive':'#82e4bd','--input-bg':'#1a2427','--focus':'#55d6b9','--shadow':'#00000055'}},
  ];
  for(const theme of themes)Object.assign(theme.tokens,{
    '--table-image':'url("/assets/themes/tables-portrait-v7.webp")','--table-size':'300% 133.333333%',
    '--table-ratio':String(2/3),'--table-portrait-window':'.75',
    '--table-wide-image':'url("/assets/themes/tables-wide-v7.webp")',
  });
  const valid = id => themes.some(theme=>theme.id===id);
  function createThemeStore(storage) {
    const memory=new Map();let account=null;
    const read=key=>{try{return storage?.getItem(key)??memory.get(key);}catch{return memory.get(key);}};
    const write=(key,value)=>{memory.set(key,value);try{storage?.setItem(key,value);}catch{}};
    const key=()=>account?'holdem-theme:'+account:'holdem-theme';
    const current=()=>{const id=read(key())??read('holdem-theme');return valid(id)?id:'fresh';};
    return {current,key,setAccount(id){account=typeof id==='string'&&id.length<=160?id:null;return current();},
      select(id){if(valid(id)){write(key(),id);write('holdem-theme',id);}return current();}};
  }
  const api={themes,createThemeStore};
  if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
  let storage;try{storage=root.localStorage;}catch{}
  const store=createThemeStore(storage);
  function apply() {
    const theme=themes.find(theme=>theme.id===store.current());
    const html=document.documentElement;
    html.dataset.theme=theme.id;html.dataset.colorMode=theme.dark?'dark':'light';html.style.colorScheme=theme.dark?'dark':'light';
    for(const [key,value]of Object.entries(theme.tokens))html.style.setProperty(key,value);
    for(const button of document.querySelectorAll('[data-theme-choice]')){
      const selected=button.dataset.themeChoice===theme.id;
      button.setAttribute('aria-checked',String(selected));button.tabIndex=selected?0:-1;
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme.tokens['--surface']);
    root.dispatchEvent(new CustomEvent('holdem-theme-change',{detail:{id:theme.id}}));
  }
  function mount() {
    for(const picker of document.querySelectorAll('[data-theme-picker]')){
      if(picker.dataset.ready)continue;picker.dataset.ready='true';picker.setAttribute('role','radiogroup');picker.setAttribute('aria-label','牌室主题');
      themes.forEach((theme,index)=>{
        const button=document.createElement('button');button.type='button';button.dataset.themeChoice=theme.id;button.setAttribute('role','radio');button.title=theme.label;
        const swatch=document.createElement('span');swatch.className='theme-swatch';swatch.style.backgroundImage=theme.tokens['--table-image'];swatch.style.backgroundSize=theme.tokens['--table-size'];swatch.style.backgroundPosition=theme.tokens['--table-x']+' 50%';swatch.setAttribute('aria-hidden','true');
        const label=document.createElement('span');label.textContent=theme.label;button.append(swatch,label);
        button.onclick=()=>{store.select(theme.id);apply();};
        button.onkeydown=event=>{
          if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
          event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?themes.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+themes.length)%themes.length;
          store.select(themes[next].id);apply();picker.children[next].focus();
        };
        picker.append(button);
      });
    }
    apply();
  }
  root.HoldemTheme={...api,get current(){return store.current();},select(id){store.select(id);apply();},setAccount(id){store.setAccount(id);apply();},mount};
  apply();
  document.addEventListener('DOMContentLoaded',mount);
  root.addEventListener('storage',event=>{if(event.key===store.key()||event.key==='holdem-theme')apply();});
})(typeof globalThis!=='undefined'?globalThis:this);
