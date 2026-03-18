const express = require("express");
const app = express();
const mongoose = require("mongoose");
const Listing = require("./models/listing.js");
const User = require("./models/user.js");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const multer = require("multer");
const session = require("express-session");
const bcrypt = require("bcryptjs");

const mongoUrl = "mongodb://127.0.0.1:27017/wanderlust";

// Multer configuration for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "public", "uploads"));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const imageFileFilter = function (req, file, cb) {
  const allowedTypes = /jpeg|jpg|png/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error("Only JPG, JPEG, and PNG image files are allowed"));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: imageFileFilter,
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.engine("ejs", ejsMate);
app.use(express.static(path.join(__dirname, "/public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "staybee-session-secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session?.user || null;
  res.locals.hideSearch = false;
  next();
});

const requireLogin = (req, res, next) => {
  if (!req.session?.user) return res.redirect("/login");
  return next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session?.user) return res.redirect("/login");
  if (req.session.user.role !== "admin") return res.status(403).send("Forbidden");
  return next();
};

main()
  .then(() => {
    console.log("connected to DB");
  })
  .catch((err) => {
    console.log(err);
  });

async function main() {
  await mongoose.connect(mongoUrl);
}

app.get("/", (req, res) => {
  if (!req.session?.user) return res.redirect("/login");
  return res.redirect("/listings");
});

app.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect("/listings");
  res.locals.hideSearch = true;
  res.render("auth/login.ejs", { error: null });
});

app.get("/register", (req, res) => {
  if (req.session?.user) return res.redirect("/listings");
  res.locals.hideSearch = true;
  res.render("auth/register.ejs", { error: null });
});

app.post("/register", async (req, res) => {
  try {
    const username = (req.body?.username || "").trim();
    const password = req.body?.password || "";
    const confirmPassword = req.body?.confirmPassword || "";
    const role = req.body?.role === "admin" ? "admin" : "user";
    const adminSignupSecret = req.body?.adminSignupSecret || "";

    if (!username) return res.status(400).render("auth/register.ejs", { error: "Username is required." });
    if (password.length < 4)
      return res.status(400).render("auth/register.ejs", { error: "Password must be at least 4 characters." });
    if (password !== confirmPassword)
      return res.status(400).render("auth/register.ejs", { error: "Passwords do not match." });

    if (role === "admin") {
      const requiredSecret = process.env.ADMIN_SIGNUP_SECRET || "staybee-admin";
      if (adminSignupSecret !== requiredSecret) {
        return res
          .status(400)
          .render("auth/register.ejs", { error: "Invalid admin secret. Ask your admin for the secret." });
      }
    }

    const existing = await User.findOne({ username });
    if (existing) return res.status(409).render("auth/register.ejs", { error: "Username already exists." });

    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ username, passwordHash, role });

    res.redirect("/login");
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).render("auth/register.ejs", { error: "Something went wrong. Please try again." });
  }
});

app.post("/login", async (req, res) => {
  try {
    const username = (req.body?.username || "").trim();
    const password = req.body?.password || "";

    if (!username || !password) {
      return res.status(400).render("auth/login.ejs", { error: "Username and password are required." });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(401).render("auth/login.ejs", { error: "Invalid username or password." });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).render("auth/login.ejs", { error: "Invalid username or password." });

    req.session.user = { name: user.username, role: user.role };
    res.redirect("/listings");
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).render("auth/login.ejs", { error: "Something went wrong. Please try again." });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/listings", async (req, res) => {
  if (!req.session?.user) return res.redirect("/login");
  const { minPrice, maxPrice, location } = req.query;

  const filter = {};

  if (minPrice) {
    filter.price = { ...filter.price, $gte: Number(minPrice) };
  }

  if (maxPrice) {
    filter.price = { ...filter.price, $lte: Number(maxPrice) };
  }

  if (location) {
    filter.location = { $regex: location, $options: "i" };
  }

  const allListing = await Listing.find(filter);

  const filters = {
    minPrice: minPrice || "",
    maxPrice: maxPrice || "",
    location: location || "",
  };

  res.render("listings/index", { allListing, filters });
});

// NEW Route
app.get("/listings/new", requireAdmin, (req, res) => {
  res.render("listings/new.ejs");
});

//Show route

app.get("/listings/:id", async (req, res) => {
  if (!req.session?.user) return res.redirect("/login");
  let { id } = req.params;
  const listing = await Listing.findById(id);
  res.render("listings/show.ejs", { listing });
});

app.post("/listings", requireAdmin, upload.array("images", 10), async (req, res) => {
  try {
    const listingData = req.body.listing || {};

    if (req.files && req.files.length > 0) {
      const imagePaths = req.files.map((file) => `/uploads/${file.filename}`);
      listingData.images = imagePaths;
      // Also set primary image for backward compatibility
      listingData.image = imagePaths[0];
    }

    const newlisting = new Listing(listingData);
    await newlisting.save();
    res.redirect("/listings");
  } catch (err) {
    console.error("Error creating listing:", err);
    res.status(500).send("Error creating listing. Please try again.");
  }
});

//Edit

app.get("/listings/:id/edit", requireAdmin, async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id);
  res.render("listings/edit.ejs", { listing });
});

//Update route
app.put("/listings/:id", requireAdmin, upload.array("images", 10), async (req, res) => {
  try {
    let { id } = req.params;
    const updatedData = req.body.listing || {};

    if (req.files && req.files.length > 0) {
      const imagePaths = req.files.map((file) => `/uploads/${file.filename}`);
      updatedData.images = imagePaths;
      updatedData.image = imagePaths[0];
    }

    await Listing.findByIdAndUpdate(id, updatedData);
    res.redirect(`/listings/${id}`);
  } catch (err) {
    console.error("Error updating listing:", err);
    res.status(500).send("Error updating listing. Please try again.");
  }
});

// DELETE ROUTE
app.delete("/listings/:id", requireAdmin, async (req, res) => {
  let { id } = req.params;
  let deletedListing = await Listing.findByIdAndDelete(id);
  console.log(deletedListing);
  res.redirect("/listings");
});

// app.get("/testListing", async (req,res)=>{
//     let samplelisting=new Listing({
//         title:"My New Villa",
//         description:"By the beach",
//         price:1500,
//         location:"Calangute , Goa",
//         country:"India",
//     });

//     await samplelisting.save();
//     console.log("sample was saved");
//     res.send("successfull testing");
// });

app.listen(5055, () => {
  console.log("server is listning on port 5055");
});
