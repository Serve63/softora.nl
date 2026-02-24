(function(){
  const io = new IntersectionObserver((entries)=>{ entries.forEach(e=>{ if(e.isIntersecting) e.target.classList.add("in"); }); }, { threshold: .12 });
  document.querySelectorAll(".reveal").forEach(el=>io.observe(el));
  document.querySelectorAll(".faq-q").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const item = btn.closest(".faq-item");
      document.querySelectorAll(".faq-item").forEach(x=>{ if(x!==item) x.classList.remove("open"); });
      item.classList.toggle("open");
    });
  });
  document.querySelectorAll("form[data-demo]").forEach(form=>{
    form.addEventListener("submit", (e)=>{
      e.preventDefault();
      const ok = form.querySelector(".success");
      if(ok) ok.hidden = false;
      form.reset();
    });
  });
})();