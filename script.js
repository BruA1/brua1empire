document.getElementById('year')?.replaceChildren(document.createTextNode(new Date().getFullYear()));
const filter=document.getElementById('brandFilter');if(filter){filter.addEventListener('change',()=>{document.querySelectorAll('[data-brand]').forEach(el=>{el.hidden=filter.value!=='all'&&el.dataset.brand!==filter.value;});});}
