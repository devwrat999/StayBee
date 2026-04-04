/**
 * StayBee — Google Maps JavaScript API: picker & lazy preview.
 *
 * Loads the API once (core library only; Geocoder + Map + Marker — no Places Autocomplete).
 */
(function (global) {
  var SCRIPT_ID = "staybee-google-maps-js";

  /**
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  function ensureGoogleMapsLoaded(apiKey) {
    if (!apiKey || String(apiKey).trim() === "") {
      return Promise.reject(new Error("Google Maps API key is missing."));
    }

    if (
      global.google &&
      global.google.maps &&
      typeof global.google.maps.Map === "function"
    ) {
      return Promise.resolve();
    }

    if (global.__stayBeeMapsPromise) {
      return global.__stayBeeMapsPromise;
    }

    global.__stayBeeMapsPromise = new Promise(function (resolve, reject) {
      var existing = document.getElementById(SCRIPT_ID);
      if (existing) {
        var tries = 0;
        var iv = setInterval(function () {
          tries++;
          if (
            global.google &&
            global.google.maps &&
            typeof global.google.maps.Map === "function"
          ) {
            clearInterval(iv);
            resolve();
          } else if (tries > 120) {
            clearInterval(iv);
            global.__stayBeeMapsPromise = null;
            reject(
              new Error(
                "Google Maps script is present but the API did not initialize.",
              ),
            );
          }
        }, 50);
        return;
      }

      var cbName = "__stayBeeGmapsCb_" + Date.now();
      global[cbName] = function () {
        try {
          delete global[cbName];
        } catch (e) {}
        if (
          global.google &&
          global.google.maps &&
          typeof global.google.maps.Map === "function"
        ) {
          resolve();
        } else {
          global.__stayBeeMapsPromise = null;
          reject(
            new Error(
              "Maps JavaScript API loaded but Map is unavailable.",
            ),
          );
        }
      };

      var s = document.createElement("script");
      s.id = SCRIPT_ID;
      s.async = true;
      s.src =
        "https://maps.googleapis.com/maps/api/js?key=" +
        encodeURIComponent(apiKey) +
        "&v=weekly&callback=" +
        cbName;
      s.onerror = function () {
        global.__stayBeeMapsPromise = null;
        try {
          delete global[cbName];
        } catch (e2) {}
        reject(new Error("Failed to load the Google Maps JavaScript API."));
      };
      document.head.appendChild(s);
    });

    return global.__stayBeeMapsPromise;
  }

  global.__stayBeeEnsureGoogleMapsLoaded = ensureGoogleMapsLoaded;
  global.__stayBeeEnsureGoogleMapsWithPlaces = ensureGoogleMapsLoaded;

  if (!global.__stayBeeGmAuthHooked) {
    global.__stayBeeGmAuthHooked = true;
    var prevAuthFail = global.gm_authFailure;
    global.gm_authFailure = function () {
      if (typeof prevAuthFail === "function") {
        try {
          prevAuthFail();
        } catch (e) {}
      }
      console.warn(
        "[StayBee Maps] Authentication failed. Check API key, Maps JavaScript API enabled, billing, and HTTP referrer restrictions for this URL.",
      );
    };
  }
})(typeof window !== "undefined" ? window : this);

(function () {
  var cfg = window.__STAYBEE_MAP_PICKER__;
  if (!cfg || !cfg.apiKey) return;

  function showPickerError(msg) {
    var el = document.getElementById("staybeeMapPickerError");
    var loading = document.getElementById("staybeeMapPickerLoading");
    if (loading) loading.classList.add("d-none");
    if (el) {
      el.textContent = msg;
      el.classList.remove("d-none");
    }
  }

  function hidePickerError() {
    var el = document.getElementById("staybeeMapPickerError");
    if (el) el.classList.add("d-none");
  }

  function hidePickerLoading() {
    var loading = document.getElementById("staybeeMapPickerLoading");
    if (loading) loading.classList.add("d-none");
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(null, args);
      }, ms);
    };
  }

  function parseCoord(val) {
    if (val == null) return null;
    var s = String(val).trim().replace(",", ".");
    if (s === "") return null;
    var n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  function isValidLatLng(lat, lng) {
    return (
      lat != null &&
      lng != null &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  }

  function initPicker() {
    var mapEl = document.getElementById("staybeeMapPicker");
    if (!mapEl) return;

    var section = document.querySelector("[data-staybee-map-section]");
    if (section && section.getAttribute("data-staybee-maps-initialized") === "1") {
      return;
    }
    if (section) section.setAttribute("data-staybee-maps-initialized", "1");

    var latInput = document.getElementById("listingLatitude");
    var lngInput = document.getElementById("listingLongitude");
    var addrInput = document.getElementById("listingLocationAddress");
    var clearBtn = document.getElementById("staybeeMapClearLocation");
    var geoBtn = document.getElementById("staybeeUseCurrentLocation");

    var center = { lat: cfg.centerLat, lng: cfg.centerLng };
    var map = new google.maps.Map(mapEl, {
      center: center,
      zoom: cfg.hasExistingCoords ? 15 : 5,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });

    var marker = new google.maps.Marker({
      map: map,
      draggable: true,
      animation: google.maps.Animation.DROP,
    });

    if (!cfg.hasExistingCoords) {
      marker.setVisible(false);
    }

    var geocoder = new google.maps.Geocoder();
    var syncingFromMap = false;

    function fillCoordInputs(lat, lng) {
      var ls = lat.toFixed(7);
      var ln = lng.toFixed(7);
      syncingFromMap = true;
      if (latInput) latInput.value = ls;
      if (lngInput) lngInput.value = ln;
      syncingFromMap = false;
    }

    function setPosition(latLng, optAddress, skipGeocode) {
      marker.setVisible(true);
      marker.setPosition(latLng);
      map.panTo(latLng);
      var lat = typeof latLng.lat === "function" ? latLng.lat() : latLng.lat;
      var lng = typeof latLng.lng === "function" ? latLng.lng() : latLng.lng;
      fillCoordInputs(lat, lng);
      hidePickerError();
      if (optAddress && addrInput) {
        addrInput.value = optAddress;
      } else if (!skipGeocode && addrInput) {
        geocoder.geocode({ location: latLng }, function (results, status) {
          if (status === "OK" && results && results[0]) {
            addrInput.value = results[0].formatted_address;
          }
        });
      }
    }

    function applyManualCoordinates() {
      if (syncingFromMap) return;
      var lat = parseCoord(latInput ? latInput.value : "");
      var lng = parseCoord(lngInput ? lngInput.value : "");
      if (lat == null && lng == null) {
        hidePickerError();
        return;
      }
      if (lat == null || lng == null) {
        showPickerError("Enter both latitude and longitude, or clear both fields.");
        return;
      }
      if (!isValidLatLng(lat, lng)) {
        showPickerError(
          "Use valid latitude (−90 to 90) and longitude (−180 to 180), or use the map.",
        );
        return;
      }
      hidePickerError();
      var ll = new google.maps.LatLng(lat, lng);
      setPosition(ll, null, false);
      map.setZoom(Math.max(map.getZoom(), 14));
    }

    function trySyncManualCoordsWhileTyping() {
      if (syncingFromMap) return;
      var lat = parseCoord(latInput ? latInput.value : "");
      var lng = parseCoord(lngInput ? lngInput.value : "");
      if (lat == null && lng == null) {
        hidePickerError();
        return;
      }
      if (!isValidLatLng(lat, lng)) return;
      hidePickerError();
      var ll = new google.maps.LatLng(lat, lng);
      setPosition(ll, null, false);
      map.setZoom(Math.max(map.getZoom(), 14));
    }

    var debouncedWhileTyping = debounce(trySyncManualCoordsWhileTyping, 450);

    if (latInput) {
      latInput.addEventListener("input", function () {
        if (!syncingFromMap) debouncedWhileTyping();
      });
      latInput.addEventListener("blur", function () {
        if (!syncingFromMap) applyManualCoordinates();
      });
    }
    if (lngInput) {
      lngInput.addEventListener("input", function () {
        if (!syncingFromMap) debouncedWhileTyping();
      });
      lngInput.addEventListener("blur", function () {
        if (!syncingFromMap) applyManualCoordinates();
      });
    }

    if (cfg.initialLat != null && cfg.initialLng != null) {
      setPosition(
        { lat: cfg.initialLat, lng: cfg.initialLng },
        cfg.initialAddress || "",
        true,
      );
      map.setZoom(15);
    }

    map.addListener("click", function (e) {
      setPosition(e.latLng);
    });

    marker.addListener("dragend", function () {
      var pos = marker.getPosition();
      if (pos) setPosition(pos);
    });

    google.maps.event.addListenerOnce(map, "idle", function () {
      hidePickerLoading();
    });

    if (geoBtn) {
      geoBtn.addEventListener("click", function () {
        hidePickerError();
        if (!navigator.geolocation) {
          showPickerError("Your browser does not support geolocation.");
          return;
        }
        geoBtn.disabled = true;
        geoBtn.setAttribute("aria-busy", "true");
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            geoBtn.disabled = false;
            geoBtn.removeAttribute("aria-busy");
            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;
            setPosition({ lat: lat, lng: lng }, null, false);
            map.setZoom(16);
          },
          function (err) {
            geoBtn.disabled = false;
            geoBtn.removeAttribute("aria-busy");
            var msg = "Could not retrieve your current location.";
            if (err && err.code === 1) {
              msg =
                "Location permission denied. Allow location in your browser settings, or set the pin manually.";
            } else if (err && err.code === 2) {
              msg = "Your position is unavailable. Try again or place the pin on the map.";
            } else if (err && err.code === 3) {
              msg = "Location request timed out. Try again.";
            }
            showPickerError(msg);
          },
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
        );
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        marker.setVisible(false);
        syncingFromMap = true;
        if (latInput) latInput.value = "";
        if (lngInput) lngInput.value = "";
        syncingFromMap = false;
        if (addrInput) addrInput.value = "";
        map.setCenter(center);
        map.setZoom(5);
        hidePickerError();
      });
    }

    var form = document.querySelector("[data-staybee-listing-form]");
    if (form && form.getAttribute("data-require-map-location") === "true") {
      form.addEventListener("submit", function (e) {
        var lat = parseCoord(latInput ? latInput.value : "");
        var lng = parseCoord(lngInput ? lngInput.value : "");
        if (!isValidLatLng(lat, lng)) {
          e.preventDefault();
          showPickerError(
            "Please set a valid location: use the map, current location, or enter latitude and longitude.",
          );
          mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
  }

  window.__stayBeeEnsureGoogleMapsLoaded(cfg.apiKey)
    .then(function () {
      initPicker();
    })
    .catch(function (err) {
      hidePickerLoading();
      showPickerError(
        err.message ||
          "Could not load Google Maps. Verify GOOGLE_MAPS_API_KEY, referrer restrictions, and that Maps JavaScript API is enabled.",
      );
    });
})();

(function () {
  var cfg = window.__STAYBEE_MAP_PREVIEW__;
  if (!cfg || !cfg.apiKey || cfg.lat == null || cfg.lng == null) return;

  var el = document.getElementById("staybeeMapPreview");
  if (!el) return;

  function showPreviewError(msg) {
    var wrap = el.closest("[data-staybee-map-preview-wrap]");
    var err = wrap && wrap.querySelector("[data-staybee-map-preview-error]");
    var load = wrap && wrap.querySelector("[data-staybee-map-preview-loading]");
    if (load) load.classList.add("d-none");
    if (err) {
      err.textContent = msg;
      err.classList.remove("d-none");
    }
  }

  function hidePreviewLoading() {
    var wrap = el.closest("[data-staybee-map-preview-wrap]");
    var load = wrap && wrap.querySelector("[data-staybee-map-preview-loading]");
    if (load) load.classList.add("d-none");
  }

  function initPreview() {
    var pos = { lat: cfg.lat, lng: cfg.lng };
    var map = new google.maps.Map(el, {
      center: pos,
      zoom: 15,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
    new google.maps.Marker({
      map: map,
      position: pos,
      animation: google.maps.Animation.DROP,
    });
    hidePreviewLoading();
  }

  function start() {
    window
      .__stayBeeEnsureGoogleMapsLoaded(cfg.apiKey)
      .then(function () {
        initPreview();
      })
      .catch(function (err) {
        hidePreviewLoading();
        showPreviewError(
          err.message ||
            "Map could not be loaded. You can still use Open in Google Maps below.",
        );
      });
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            io.disconnect();
            start();
          }
        });
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
  } else {
    start();
  }
})();
