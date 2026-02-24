(function(){
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){ if(entry.isIntersecting) entry.target.classList.add("in"); });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(function(el){ io.observe(el); });

  document.querySelectorAll(".faq-question").forEach(function(btn){
    btn.addEventListener("click", function(){
      var item = btn.closest(".faq-item");
      document.querySelectorAll(".faq-item").forEach(function(el){ if(el !== item) el.classList.remove("open"); });
      item.classList.toggle("open");
    });
  });

  var navToggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".site-nav");
  if(navToggle && nav){
    navToggle.addEventListener("click", function(){
      if(nav.style.display === "flex"){ nav.style.display = "none"; }
      else { nav.style.display = "flex"; nav.style.flexDirection = "column"; nav.style.alignItems = "flex-start"; }
    });
  }

  document.querySelectorAll("form[data-demo-form]").forEach(function(form){
    form.addEventListener("submit", function(e){
      e.preventDefault();
      var msg = form.querySelector(".form-feedback");
      if(msg) msg.hidden = false;
      form.reset();
    });
  });
})();