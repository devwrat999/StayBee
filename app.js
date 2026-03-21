const express = require("express");
const app = express();
const mongoose = require("mongoose");
const Listing = require("./models/listing.js");
const User = require("./models/user.js");
const Review = require("./models/review.js");
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
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase(),
  );
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
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
  }),
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
  if (req.session.user.role !== "admin")
    return res.status(403).send("Forbidden");
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
  const legacy = await Listing.find({
    rating: { $exists: true },
    averageRating: null,
  });
  for (const l of legacy) {
    if (l.rating != null) {
      await Listing.findByIdAndUpdate(l._id, {
        averageRating: l.rating,
        reviewCount: 1,
        $unset: { rating: 1 },
      });
    }
  }
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

    if (!username)
      return res
        .status(400)
        .render("auth/register.ejs", { error: "Username is required." });
    if (password.length < 4)
      return res
        .status(400)
        .render("auth/register.ejs", {
          error: "Password must be at least 4 characters.",
        });
    if (password !== confirmPassword)
      return res
        .status(400)
        .render("auth/register.ejs", { error: "Passwords do not match." });

    if (role === "admin") {
      const requiredSecret = process.env.ADMIN_SIGNUP_SECRET || "staybee-admin";
      if (adminSignupSecret !== requiredSecret) {
        return res
          .status(400)
          .render("auth/register.ejs", {
            error: "Invalid admin secret. Ask your admin for the secret.",
          });
      }
    }

    const existing = await User.findOne({ username });
    if (existing)
      return res
        .status(409)
        .render("auth/register.ejs", { error: "Username already exists." });

    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ username, passwordHash, role });

    res.redirect("/login");
  } catch (err) {
    console.error("Register error:", err);
    res
      .status(500)
      .render("auth/register.ejs", {
        error: "Something went wrong. Please try again.",
      });
  }
});

app.post("/login", async (req, res) => {
  try {
    const username = (req.body?.username || "").trim();
    const password = req.body?.password || "";

    if (!username || !password) {
      return res
        .status(400)
        .render("auth/login.ejs", {
          error: "Username and password are required.",
        });
    }

    const user = await User.findOne({ username });
    if (!user)
      return res
        .status(401)
        .render("auth/login.ejs", { error: "Invalid username or password." });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok)
      return res
        .status(401)
        .render("auth/login.ejs", { error: "Invalid username or password." });

    req.session.user = {
      id: user._id.toString(),
      name: user.username,
      role: user.role,
    };
    res.redirect("/listings");
  } catch (err) {
    console.error("Login error:", err);
    res
      .status(500)
      .render("auth/login.ejs", {
        error: "Something went wrong. Please try again.",
      });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/listings", async (req, res) => {
  if (!req.session?.user) return res.redirect("/login");
  const { minPrice, maxPrice, location, sort } = req.query;

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

  let query = Listing.find(filter);
  if (sort === "price_asc") query = query.sort({ price: 1 });
  else if (sort === "price_desc") query = query.sort({ price: -1 });
  const allListing = await query;

  let userFavouriteIds = [];
  if (req.session?.user?.id) {
    const u = await User.findById(req.session.user.id).select("favourites");
    userFavouriteIds = (u?.favourites || []).map((id) => id.toString());
  }

  const filters = {
    minPrice: minPrice || "",
    maxPrice: maxPrice || "",
    location: location || "",
    sort: sort || "",
  };

  res.render("listings/index", { allListing, filters, userFavouriteIds });
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
  let isFavourite = false;
  let userReview = null;
  if (req.session?.user?.id && listing) {
    const u = await User.findById(req.session.user.id).select("favourites");
    isFavourite = (u?.favourites || []).some(
      (fid) => fid.toString() === listing._id.toString(),
    );
    userReview = await Review.findOne({
      listing: id,
      author: req.session.user.id,
    });
  }
  const reviews = await Review.find({ listing: id })
    .populate("author", "username")
    .sort({ createdAt: -1 });
  const err = req.query.err || null;
  res.render("listings/show.ejs", {
    listing,
    isFavourite,
    reviews,
    userReview,
    err,
  });
});

app.post(
  "/listings",
  requireAdmin,
  upload.array("images", 10),
  async (req, res) => {
    try {
      const listingData = req.body.listing || {};
      if (!listingData.status) listingData.status = "Available";

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
  },
);

//Edit

app.get("/listings/:id/edit", requireAdmin, async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id);
  res.render("listings/edit.ejs", { listing });
});

//Update route
app.put(
  "/listings/:id",
  requireAdmin,
  upload.array("images", 10),
  async (req, res) => {
    try {
      let { id } = req.params;
      const updatedData = req.body.listing || {};
      if (!updatedData.status) updatedData.status = "Available";
      const listing = await Listing.findById(id);
      if (!listing) return res.status(404).send("Listing not found.");

      const deleteImagesRaw = req.body.deleteImages;
      const deleteImages = Array.isArray(deleteImagesRaw)
        ? deleteImagesRaw
        : deleteImagesRaw
          ? [deleteImagesRaw]
          : [];

      const existingImages = Array.isArray(listing.images)
        ? listing.images
        : [];
      const remainingImages = existingImages.filter(
        (imgPath) => !deleteImages.includes(imgPath),
      );
      let finalImages = remainingImages;

      if (req.files && req.files.length > 0) {
        const imagePaths = req.files.map((file) => `/uploads/${file.filename}`);
        // Keep existing images and append newly uploaded ones.
        finalImages = [...remainingImages, ...imagePaths];
      }

      updatedData.images = finalImages;
      if (finalImages.length > 0) {
        updatedData.image = finalImages[0];
      } else {
        updatedData.image =
          "https://images.unsplash.com/photo-1519046904884-53103b34b206?q=80&w=1170&auto=format&fit=crop";
      }

      await Listing.findByIdAndUpdate(id, updatedData);
      res.redirect(`/listings/${id}`);
    } catch (err) {
      console.error("Error updating listing:", err);
      res.status(500).send("Error updating listing. Please try again.");
    }
  },
);

// DELETE ROUTE
app.delete("/listings/:id", requireAdmin, async (req, res) => {
  let { id } = req.params;
  let deletedListing = await Listing.findByIdAndDelete(id);
  console.log(deletedListing);
  res.redirect("/listings");
});

// FAVOURITES (WISHLIST)
app.get("/favourites", requireLogin, async (req, res) => {
  const user = await User.findById(req.session.user.id).populate("favourites");
  const allListing = (user?.favourites || []).filter(Boolean);
  res.render("listings/favourites.ejs", { allListing });
});

app.post("/listings/:id/favourite", requireLogin, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  await User.findByIdAndUpdate(userId, { $addToSet: { favourites: id } });
  const referer = req.get("Referer") || `/listings/${id}`;
  res.redirect(referer);
});

app.delete("/listings/:id/favourite", requireLogin, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  await User.findByIdAndUpdate(userId, { $pull: { favourites: id } });
  const referer = req.get("Referer") || `/listings/${id}`;
  res.redirect(referer);
});

app.post("/listings/:id/favourite/toggle", requireLogin, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  const user = await User.findById(userId).select("favourites");

  let isFavourite = false;
  if (user) {
    const alreadyFavourite = (user.favourites || []).some(
      (favId) => favId.toString() === id,
    );
    if (alreadyFavourite) {
      user.favourites = (user.favourites || []).filter(
        (favId) => favId.toString() !== id,
      );
      isFavourite = false;
    } else {
      user.favourites.push(id);
      isFavourite = true;
    }
    await user.save();
  }

  const wantsJson =
    req.xhr ||
    (req.get("Accept") || "").includes("application/json") ||
    req.get("X-Requested-With") === "XMLHttpRequest";

  if (wantsJson) {
    return res.json({ success: true, isFavourite });
  }

  const referer = req.get("Referer") || `/listings/${id}`;
  return res.redirect(referer);
});

async function updateListingRating(listingId) {
  const reviews = await Review.find({ listing: listingId });
  const avg = reviews.length
    ? Math.round(
        (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10,
      ) / 10
    : null;
  await Listing.findByIdAndUpdate(listingId, {
    averageRating: avg,
    reviewCount: reviews.length,
  });
}

app.post("/listings/:id/reviews", requireLogin, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.id;
  if (req.session.user.role === "admin")
    return res.status(403).send("Admins cannot post reviews.");
  const existing = await Review.findOne({ listing: id, author: userId });
  if (existing) return res.redirect(`/listings/${id}?err=already_reviewed`);
  const rating = parseInt(req.body.rating, 10);
  if (!rating || rating < 1 || rating > 5)
    return res.redirect(`/listings/${id}?err=invalid_rating`);
  await Review.create({
    listing: id,
    author: userId,
    rating,
    comment: (req.body.comment || "").trim(),
  });
  await updateListingRating(id);
  res.redirect(`/listings/${id}`);
});

app.put("/reviews/:reviewId", requireLogin, async (req, res) => {
  const { reviewId } = req.params;
  const review = await Review.findById(reviewId);
  if (!review) return res.status(404).send("Review not found.");
  if (review.author.toString() !== req.session.user.id)
    return res.status(403).send("You can only edit your own review.");
  const rating = parseInt(req.body.rating, 10);
  if (!rating || rating < 1 || rating > 5)
    return res.redirect(`/listings/${review.listing}?err=invalid_rating`);
  review.rating = rating;
  review.comment = (req.body.comment || "").trim();
  await review.save();
  await updateListingRating(review.listing.toString());
  res.redirect(`/listings/${review.listing}`);
});

app.listen(8080, () => {
  console.log("Server is running at:");
  console.log("http://localhost:8080");
});
