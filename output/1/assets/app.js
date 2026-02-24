(function(){
  var observer = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(entry.isIntersecting) entry.target.classList.add("in");
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(function(el){ observer.observe(el); });

  document.querySelectorAll(".faq-question").forEach(function(btn){
    btn.addEventListener("click", function(){
      var item = btn.closest(".faq-item");
      document.querySelectorAll(".faq-item").forEach(function(x){ if(x !== item) x.classList.remove("open"); });
      item.classList.toggle("open");
    });
  });

  var navToggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".site-nav");
  if(navToggle && nav){
    navToggle.addEventListener("click", function(){
      nav.classList.toggle("open");
      if(nav.classList.contains("open")){
        nav.style.display = "flex";
      } else {
        nav.style.display = "none";
      }
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