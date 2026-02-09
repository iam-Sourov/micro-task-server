const express = require('express');
const cors = require('cors');
require('dotenv').config();

if (!process.env.DB_USER || !process.env.DB_PASS) {
  console.error('Missing DB_USER or DB_PASS in .env. Server cannot connect to MongoDB.');
  process.exit(1);
}

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');

const app = express();
const port = process.env.PORT || 5000;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? new Stripe(stripeKey) : null;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@mystic.fupfbwc.mongodb.net/?appName=Mystic`;

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'micro-task-secret');
    req.user = decoded;
    next();
  } catch {
    return res.status(401).send({ message: 'Invalid or expired token' });
  }
}

async function run() {
  try {
    await client.connect();
    const db = client.db('microTaskDB');
    const userCollection = db.collection('users');
    const taskCollection = db.collection('tasks');
    const submissionCollection = db.collection('submissions');
    const paymentCollection = db.collection('payments');
    const withdrawalCollection = db.collection('withdrawals');
    const notificationCollection = db.collection('notifications');

    const verifyAdmin = async (req, res, next) => {
      const dbUser = await userCollection.findOne({ email: req.user?.email });
      if (dbUser?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden' });
      }
      next();
    };

    const verifyBuyer = async (req, res, next) => {
      const dbUser = await userCollection.findOne({ email: req.user?.email });
      if (dbUser?.role !== 'buyer') {
        return res.status(403).send({ message: 'Forbidden' });
      }
      next();
    };

    const verifyWorker = async (req, res, next) => {
      const dbUser = await userCollection.findOne({ email: req.user?.email });
      if (dbUser?.role !== 'worker') {
        return res.status(403).send({ message: 'Forbidden' });
      }
      next();
    };

    function addNotification(data) {
      return notificationCollection.insertOne({
        ...data,
        time: new Date()
      });
    }

    console.log('Connected to MongoDB');

    app.get('/', (req, res) => {
      res.send('Micro Task Server is running');
    });

    // JWT for logged-in user
    app.post('/jwt', async (req, res) => {
      const { email } = req.body;
      const user = await userCollection.findOne({ email });
      if (!user) return res.status(404).send({ message: 'User not found' });
      const token = jwt.sign(
        { email },
        process.env.JWT_SECRET || 'micro-task-secret',
        { expiresIn: '7d' }
      );
      res.send({ token });
    });

    // Users
    app.post('/users', async (req, res) => {
      const user = req.body;
      const existingUser = await userCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ message: 'User already exists', insertedId: null });
      }
      let initialCoins = 0;
      if (user.role === 'worker') initialCoins = 10;
      if (user.role === 'buyer') initialCoins = 50;
      const newUser = {
        ...user,
        coins: initialCoins,
        createdAt: new Date()
      };
      const result = await userCollection.insertOne(newUser);
      res.send(result);
    });

    app.get('/users/:email', verifyToken, async (req, res) => {
      const user = await userCollection.findOne({ email: req.params.email });
      if (!user) return res.status(404).send({ message: 'User not found' });
      res.send(user);
    });

    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.find({}).toArray();
      res.send(users);
    });

    app.patch('/users/role', verifyToken, verifyAdmin, async (req, res) => {
      const { email, role } = req.body;
      const result = await userCollection.updateOne(
        { email },
        { $set: { role } }
      );
      res.send(result);
    });

    app.delete('/users/:email', verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.deleteOne({ email: req.params.email });
      res.send(result);
    });

    // Top workers (for home page)
    app.get('/users-top-workers', async (req, res) => {
      const workers = await userCollection
        .find({ role: 'worker' })
        .sort({ coins: -1 })
        .limit(6)
        .toArray();
      res.send(workers);
    });

    // Tasks
    app.get('/tasks', verifyToken, verifyWorker, async (req, res) => {
      const tasks = await taskCollection
        .find({ required_workers: { $gt: 0 } })
        .toArray();
      res.send(tasks);
    });

    app.get('/tasks/:id', verifyToken, async (req, res) => {
      const task = await taskCollection.findOne({
        _id: new ObjectId(req.params.id)
      });
      if (!task) return res.status(404).send({ message: 'Task not found' });
      res.send(task);
    });

    app.post('/tasks', verifyToken, verifyBuyer, async (req, res) => {
      const task = req.body;
      const totalCost = task.required_workers * task.payable_amount;
      const user = await userCollection.findOne({ email: task.buyer_email });
      if (!user || user.coins < totalCost) {
        return res.status(400).send({
          message: 'Not enough coins. Please purchase coins.',
          needCoins: true
        });
      }
      await userCollection.updateOne(
        { email: task.buyer_email },
        { $inc: { coins: -totalCost } }
      );
      const doc = {
        ...task,
        total_payable_amount: totalCost,
        createdAt: new Date()
      };
      const result = await taskCollection.insertOne(doc);
      res.send(result);
    });

    app.get('/tasks-buyer/:email', verifyToken, verifyBuyer, async (req, res) => {
      const tasks = await taskCollection
        .find({ buyer_email: req.params.email })
        .sort({ completion_date: -1 })
        .toArray();
      res.send(tasks);
    });

    app.patch('/tasks/:id', verifyToken, verifyBuyer, async (req, res) => {
      const { task_title, task_detail, submission_info } = req.body;
      const update = {};
      if (task_title !== undefined) update.task_title = task_title;
      if (task_detail !== undefined) update.task_detail = task_detail;
      if (submission_info !== undefined) update.submission_info = submission_info;
      const result = await taskCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: update }
      );
      res.send(result);
    });

    app.delete('/tasks/:id', verifyToken, verifyBuyer, async (req, res) => {
      const task = await taskCollection.findOne({
        _id: new ObjectId(req.params.id)
      });
      if (!task) return res.status(404).send({ message: 'Task not found' });
      const refill = task.required_workers * task.payable_amount;
      await userCollection.updateOne(
        { email: task.buyer_email },
        { $inc: { coins: refill } }
      );
      const result = await taskCollection.deleteOne({
        _id: new ObjectId(req.params.id)
      });
      res.send(result);
    });

    app.get('/tasks-admin', verifyToken, verifyAdmin, async (req, res) => {
      const tasks = await taskCollection.find({}).toArray();
      res.send(tasks);
    });

    app.delete('/tasks-admin/:id', verifyToken, verifyAdmin, async (req, res) => {
      const result = await taskCollection.deleteOne({
        _id: new ObjectId(req.params.id)
      });
      res.send(result);
    });

    // Submissions
    app.post('/submissions', verifyToken, verifyWorker, async (req, res) => {
      const submission = {
        ...req.body,
        status: 'pending',
        current_date: new Date()
      };
      const result = await submissionCollection.insertOne(submission);
      await addNotification({
        message: `New submission for task "${req.body.task_title}" from ${req.body.worker_name}`,
        toEmail: req.body.buyer_email,
        actionRoute: '/dashboard/tasks-to-review'
      });
      res.send(result);
    });

    app.get('/submissions-worker/:email', verifyToken, verifyWorker, async (req, res) => {
      const { page = 1, limit = 10 } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const total = await submissionCollection.countDocuments({
        worker_email: req.params.email
      });
      const submissions = await submissionCollection
        .find({ worker_email: req.params.email })
        .sort({ current_date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .toArray();
      res.send({ submissions, total });
    });

    app.get('/submissions-worker-approved/:email', verifyToken, verifyWorker, async (req, res) => {
      const submissions = await submissionCollection
        .find({
          worker_email: req.params.email,
          status: 'approved'
        })
        .sort({ current_date: -1 })
        .toArray();
      res.send(submissions);
    });

    app.get('/submissions-buyer/:email', verifyToken, verifyBuyer, async (req, res) => {
      const submissions = await submissionCollection
        .find({
          buyer_email: req.params.email,
          status: 'pending'
        })
        .sort({ current_date: -1 })
        .toArray();
      res.send(submissions);
    });

    app.get('/submissions/:id', verifyToken, async (req, res) => {
      const sub = await submissionCollection.findOne({
        _id: new ObjectId(req.params.id)
      });
      if (!sub) return res.status(404).send({ message: 'Not found' });
      res.send(sub);
    });

    app.patch('/submissions/approve/:id', verifyToken, verifyBuyer, async (req, res) => {
      const sub = await submissionCollection.findOne({
        _id: new ObjectId(req.params.id)
      });
      if (!sub || sub.status !== 'pending') {
        return res.status(400).send({ message: 'Invalid submission' });
      }
      await userCollection.updateOne(
        { email: sub.worker_email },
        { $inc: { coins: sub.payable_amount } }
      );
      await submissionCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: 'approved' } }
      );
      await addNotification({
        message: `You have earned ${sub.payable_amount} coins from ${sub.buyer_name} for completing "${sub.task_title}"`,
        toEmail: sub.worker_email,
        actionRoute: '/dashboard/worker-home'
      });
      res.send({ ok: true });
    });

    app.patch('/submissions/reject/:id', verifyToken, verifyBuyer, async (req, res) => {
      const sub = await submissionCollection.findOne({
        _id: new ObjectId(req.params.id)
      });
      if (!sub || sub.status !== 'pending') {
        return res.status(400).send({ message: 'Invalid submission' });
      }
      await submissionCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: 'rejected' } }
      );
      const taskId = typeof sub.task_id === 'string' ? new ObjectId(sub.task_id) : sub.task_id;
      await taskCollection.updateOne(
        { _id: taskId },
        { $inc: { required_workers: 1 } }
      );
      await addNotification({
        message: `Your submission for "${sub.task_title}" was rejected by ${sub.buyer_name}`,
        toEmail: sub.worker_email,
        actionRoute: '/dashboard/my-submissions'
      });
      res.send({ ok: true });
    });

    // Payments (Stripe or dummy)
    app.post('/create-payment-intent', verifyToken, verifyBuyer, async (req, res) => {
      const { amount, coins, buyer_email } = req.body;
      if (!amount || amount < 1) {
        return res.status(400).send({ message: 'Invalid amount' });
      }
      if (!stripe) {
        return res.send({
          clientSecret: null,
          dummy: true,
          message: 'Use confirm-dummy-payment after simulating payment'
        });
      }
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: 'usd',
          automatic_payment_methods: { enabled: true }
        });
        res.send({
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id
        });
      } catch (e) {
        res.status(500).send({ message: e.message || 'Payment failed' });
      }
    });

    app.post('/payments', verifyToken, verifyBuyer, async (req, res) => {
      const { buyer_email, coins, amount, transactionId } = req.body;
      await userCollection.updateOne(
        { email: buyer_email },
        { $inc: { coins } }
      );
      const result = await paymentCollection.insertOne({
        buyer_email,
        coins,
        amount,
        transactionId,
        date: new Date()
      });
      res.send(result);
    });

    app.get('/payments/:email', verifyToken, verifyBuyer, async (req, res) => {
      const payments = await paymentCollection
        .find({ buyer_email: req.params.email })
        .sort({ date: -1 })
        .toArray();
      res.send(payments);
    });

    // Withdrawals
    app.post('/withdrawals', verifyToken, verifyWorker, async (req, res) => {
      const w = req.body;
      if (w.withdrawal_coin < 200) {
        return res.status(400).send({
          message: 'Minimum withdrawal is 200 coins ($10)'
        });
      }
      const user = await userCollection.findOne({ email: w.worker_email });
      if (!user || user.coins < w.withdrawal_coin) {
        return res.status(400).send({ message: 'Insufficient coins' });
      }
      const doc = {
        ...w,
        status: 'pending',
        withdraw_date: new Date()
      };
      const result = await withdrawalCollection.insertOne(doc);
      res.send(result);
    });

    app.get('/withdrawals-pending', verifyToken, verifyAdmin, async (req, res) => {
      const list = await withdrawalCollection
        .find({ status: 'pending' })
        .sort({ withdraw_date: -1 })
        .toArray();
      res.send(list);
    });

    app.patch('/withdrawals/approve/:id', verifyToken, verifyAdmin, async (req, res) => {
      const w = await withdrawalCollection.findOne({
        _id: new ObjectId(req.params.id)
      });
      if (!w || w.status !== 'pending') {
        return res.status(400).send({ message: 'Invalid request' });
      }
      await userCollection.updateOne(
        { email: w.worker_email },
        { $inc: { coins: -w.withdrawal_coin } }
      );
      await withdrawalCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: 'approved' } }
      );
      await addNotification({
        message: `Your withdrawal of $${w.withdrawal_amount} has been approved.`,
        toEmail: w.worker_email,
        actionRoute: '/dashboard/withdrawals'
      });
      res.send({ ok: true });
    });

    // Notifications
    app.get('/notifications/:email', verifyToken, async (req, res) => {
      const list = await notificationCollection
        .find({ toEmail: req.params.email })
        .sort({ time: -1 })
        .limit(50)
        .toArray();
      res.send(list);
    });

    // Stats
    app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
      const totalWorkers = await userCollection.countDocuments({ role: 'worker' });
      const totalBuyers = await userCollection.countDocuments({ role: 'buyer' });
      const totalPayments = await paymentCollection.countDocuments();
      const coinStats = await userCollection
        .aggregate([{ $group: { _id: null, totalCoins: { $sum: '$coins' } } }])
        .toArray();
      res.send({
        totalWorkers,
        totalBuyers,
        totalAvailableCoins: coinStats[0]?.totalCoins || 0,
        totalPayments
      });
    });

    app.get('/buyer-stats/:email', verifyToken, verifyBuyer, async (req, res) => {
      const email = req.params.email;
      const taskCount = await taskCollection.countDocuments({ buyer_email: email });
      const tasks = await taskCollection.find({ buyer_email: email }).toArray();
      const pendingWorkers = tasks.reduce((sum, t) => sum + (t.required_workers || 0), 0);
      const payments = await paymentCollection
        .find({ buyer_email: email })
        .toArray();
      const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      res.send({
        taskCount,
        pendingWorkers,
        totalPaid
      });
    });

    app.get('/worker-stats/:email', verifyToken, verifyWorker, async (req, res) => {
      const email = req.params.email;
      const totalSubmissions = await submissionCollection.countDocuments({
        worker_email: email
      });
      const pendingSubmissions = await submissionCollection.countDocuments({
        worker_email: email,
        status: 'pending'
      });
      const approved = await submissionCollection
        .find({ worker_email: email, status: 'approved' })
        .toArray();
      const totalEarning = approved.reduce((sum, s) => sum + (s.payable_amount || 0), 0);
      res.send({
        totalSubmissions,
        pendingSubmissions,
        totalEarning
      });
    });
  } finally {
    // keep connection
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
