const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const listingSchema = new Schema({
  title: {
    type: String,
    required: true,
  },
  description: String,
  // Primary image (kept for backward compatibility)
  image: {
    type: String,
    default:
      "https://images.unsplash.com/photo-1519046904884-53103b34b206?q=80&w=1170&auto=format&fit=crop",
    set: (v) =>
      v === ""
        ? "https://images.unsplash.com/photo-1519046904884-53103b34b206?q=80&w=1170&auto=format&fit=crop"
        : v,
  },
  // New: support multiple images per listing
  images: {
    type: [String],
    default: [],
  },
  price: Number,
  location: String,
  country: String,
});

const Listing = mongoose.model("Listing", listingSchema);
module.exports = Listing;
