const express = require("express");
const app = express();
const mongoose = require("mongoose");
const Listing = require("./models/listing.js");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");

const mongoUrl = "mongodb://127.0.0.1:27017/wanderlust";

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
  res.send("Root Path");
});

app.get("/listings", async (req, res) => {
  const allListing = await Listing.find({});
  res.render("listings/index", { allListing });
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

app.post("/listings", async (req, res) => {
  // let {title,description,image,price,country,location} =req.body;
  const newlisting = new Listing(req.body.listing);
  await newlisting.save();
  res.redirect("/listings");
  console.log(listing);
});

//Edit

app.get("/listings/:id/edit", async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id);
  res.render("listings/edit.ejs", { listing });
});

//Update route
app.put("/listings/:id", async (req, res) => {
  let { id } = req.params;
  await Listing.findByIdAndUpdate(id, { ...req.body.listing });
  res.redirect(`/listings/${id}`);
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
