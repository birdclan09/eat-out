// Salt Lake County street grid: "5639 7800 South" is "5639 West 7800 South". OpenStreetMap often leaves out the East/West (or North/South) word,
// but the grid fixes it: the house number counts out from Main Street (east/west) or South Temple (north/south), so the side follows from the location.
// Only applied inside Salt Lake County, and only when the word is missing.
module.exports = (addr, la, lo) => {
  if (!(la > 40.41 && la < 40.92 && lo > -112.26 && lo < -111.73)) return addr;
  return String(addr).replace(/^(\d+) (\d+) (North|South|East|West)\b/i, (m, hn, st, dir) => {
    const d = dir.toLowerCase(), pre = (d === "north" || d === "south") ? (lo < -111.891 ? "West" : "East") : (la < 40.7677 ? "South" : "North");
    return hn + " " + pre + " " + st + " " + dir.charAt(0).toUpperCase() + dir.slice(1).toLowerCase();
  });
};
