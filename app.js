const express = require("express");
const app = express();
const mongoose = require("mongoose");
const Listing = require("./models/listing.js");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const multer = require("multer");

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
  res.redirect("/listings");
});

app.get("/listings", async (req, res) => {
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
app.get("/listings/new", (req, res) => {
  res.render("listings/new.ejs");
});

//Show route

app.get("/listings/:id", async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id);
  res.render("listings/show.ejs", { listing });
});

app.post("/listings", upload.array("images", 10), async (req, res) => {
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

app.get("/listings/:id/edit", async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id);
  res.render("listings/edit.ejs", { listing });
});

//Update route
app.put("/listings/:id", upload.array("images", 10), async (req, res) => {
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
app.delete("/listings/:id", async (req, res) => {
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

app.listen(8080, () => {
  console.log("server is listning on port 8080");
});
