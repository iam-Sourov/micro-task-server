const verifyAdmin = async (req, res, next) => {
  const user = req.user; // Set by your verifyToken middleware
  const query = { email: user?.email };
  const dbUser = await userCollection.findOne(query);
  if (dbUser?.role !== 'admin') {
    return res.status(403).send({ message: 'forbidden access' });
  }
  next();
};

const verifyBuyer = async (req, res, next) => {
  const user = req.user;
  const dbUser = await userCollection.findOne({ email: user?.email });
  if (dbUser?.role !== 'buyer') {
    return res.status(403).send({ message: 'forbidden access' });
  }
  next();
};