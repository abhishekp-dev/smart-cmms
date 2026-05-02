const express = require('express');
const path = require('path');
const session = require('express-session');
const { all, get, initializeDatabase, run, verifyPassword, generatePreventiveWorkOrders } = require('./db');
const { predictMachine } = require('./predictiveModule');
const { createNotification, getUnreadNotifications, markAsRead } = require('./notifications');

initializeDatabase();

// Run PM generator every hour
setInterval(generatePreventiveWorkOrders, 1000 * 60 * 60);
// Also run it on startup
generatePreventiveWorkOrders();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: 'cmms-demo-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

app.use((req, res, next) => {
  if (req.session.userId) {
    const user = get(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      [req.session.userId]
    );
    req.user = user || null;
  } else {
    req.user = null;
  }

  res.locals.currentPath = req.path;
  res.locals.user = req.user;
  
  if (req.user) {
    res.locals.notifications = getUnreadNotifications(req.user.id);
  } else {
    res.locals.notifications = [];
  }
  
  next();
});

function ensureAuthenticated(req, res, next) {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect('/login');
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).render('forbidden', {
        title: 'Access Denied'
      });
    }

    next();
  };
}

function hoursBetween(start, end) {
  if (!start || !end) {
    return 0;
  }

  const diff = (new Date(end).getTime() - new Date(start).getTime()) / 3600000;
  return diff > 0 ? diff : 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function renderWithError(res, view, model, statusCode = 400) {
  return res.status(statusCode).render(view, model);
}

function toCsv(rows) {
  if (!rows.length) {
    return '';
  }

  const headers = Object.keys(rows[0]);
  const escapeValue = (value) => {
    const normalized = value === null || value === undefined ? '' : String(value);
    return `"${normalized.replace(/"/g, '""')}"`;
  };

  return [
    headers.map(escapeValue).join(','),
    ...rows.map((row) => headers.map((header) => escapeValue(row[header])).join(','))
  ].join('\n');
}

function getDashboardMetrics() {
  const totalMachines = get('SELECT COUNT(*) AS count FROM machines').count;
  const activeMachines = get(
    "SELECT COUNT(*) AS count FROM machines WHERE status = 'Active'"
  ).count;
  const breakdownMachines = get(
    "SELECT COUNT(*) AS count FROM machines WHERE status = 'Breakdown'"
  ).count;

  const completedOrders = all(
    `SELECT failure_time, start_time, end_time
     FROM work_orders
     WHERE status = 'Completed'`
  );
  const allFailures = all(
    'SELECT failure_time FROM work_orders WHERE failure_time IS NOT NULL'
  );

  const totalRepairHours = completedOrders.reduce(
    (sum, order) => sum + hoursBetween(order.start_time, order.end_time),
    0
  );
  const totalWorkingHours = get(
    'SELECT COALESCE(SUM(working_hours), 0) AS total FROM machines'
  ).total;

  return {
    totalMachines,
    activeMachines,
    breakdownMachines,
    mttr: completedOrders.length
      ? (totalRepairHours / completedOrders.length).toFixed(2)
      : '0.00',
    mtbf: allFailures.length
      ? (totalWorkingHours / allFailures.length).toFixed(2)
      : '0.00'
  };
}

app.get('/', (req, res) => {
  if (req.user) {
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.user) {
    return res.redirect('/dashboard');
  }

  res.render('login', {
    title: 'Login',
    error: null
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    return renderWithError(res, 'login', {
      title: 'Login',
      error: 'Email and password are required.'
    });
  }

  const user = get(
    'SELECT id, name, email, password, role FROM users WHERE email = ?',
    [email.trim()]
  );

  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).render('login', {
      title: 'Login',
      error: 'Invalid email or password.'
    });
  }

  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.post('/logout', ensureAuthenticated, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/dashboard', ensureAuthenticated, (req, res) => {
  const metrics = getDashboardMetrics();
  const recentBreakdowns = all(
    `SELECT work_orders.id, work_orders.title, work_orders.status, work_orders.failure_time,
            machines.name AS machine_name, users.name AS technician_name
     FROM work_orders
     JOIN machines ON machines.id = work_orders.machine_id
     LEFT JOIN users ON users.id = work_orders.assigned_to
     ORDER BY datetime(work_orders.failure_time) DESC
     LIMIT 5`
  );

  const machineStatusSummary = all(
    `SELECT status, COUNT(*) AS count
     FROM machines
     GROUP BY status`
  );

  res.render('dashboard', {
    title: 'Dashboard',
    metrics,
    machineStatusSummary,
    recentBreakdowns
  });
});

app.get('/machines', ensureAuthenticated, (req, res) => {
  const machines = all(
    `SELECT machines.*,
            (SELECT COUNT(*) FROM machine_components WHERE machine_id = machines.id) AS component_count
     FROM machines
     ORDER BY name`
  );

  res.render('machines', {
    title: 'Machines',
    machines
  });
});

app.post('/machines/:id/status', allowRoles('Admin', 'Manager'), (req, res) => {
  const machineId = Number(req.params.id);
  const { status } = req.body;

  if (!Number.isInteger(machineId) || !['Active', 'Idle', 'Breakdown'].includes(status)) {
    return res.status(400).send('Invalid data');
  }

  const machine = get('SELECT loto_status, loto_user_id FROM machines WHERE id = ?', [machineId]);
  if (machine && machine.loto_status === 'Locked' && machine.loto_user_id !== req.user.id && req.user.role !== 'Admin') {
    return res.status(403).send('Machine is locked (LOTO). Only the user who locked it or an Admin can change its status.');
  }

  run('UPDATE machines SET status = ? WHERE id = ?', [status, machineId]);
  res.redirect('/machines');
});

app.post('/machines/:id/loto/lock', ensureAuthenticated, (req, res) => {
  run('UPDATE machines SET loto_status = ?, loto_user_id = ?, status = ? WHERE id = ?', ['Locked', req.user.id, 'Breakdown', Number(req.params.id)]);
  res.redirect('back');
});

app.post('/machines/:id/loto/unlock', ensureAuthenticated, (req, res) => {
  const machineId = Number(req.params.id);
  const machine = get('SELECT loto_status, loto_user_id FROM machines WHERE id = ?', [machineId]);
  if (machine && machine.loto_status === 'Locked' && machine.loto_user_id !== req.user.id && req.user.role !== 'Admin') {
    return res.status(403).send('Only the user who locked it or an Admin can unlock this machine.');
  }
  run('UPDATE machines SET loto_status = ?, loto_user_id = NULL WHERE id = ?', ['Unlocked', machineId]);
  res.redirect('back');
});

app.get('/machines/failures/export', allowRoles('Admin', 'Manager'), (req, res) => {
  const failures = all(
    `SELECT machines.name AS machine_name,
            machines.status AS machine_status,
            work_orders.title,
            work_orders.status AS work_order_status,
            COALESCE(users.name, 'Unassigned') AS technician_name,
            work_orders.failure_time,
            work_orders.start_time,
            work_orders.end_time,
            ROUND((julianday(work_orders.end_time) - julianday(work_orders.start_time)) * 24, 2) AS repair_hours
     FROM work_orders
     JOIN machines ON machines.id = work_orders.machine_id
     LEFT JOIN users ON users.id = work_orders.assigned_to
     WHERE work_orders.failure_time IS NOT NULL
     ORDER BY datetime(work_orders.failure_time) DESC`
  );

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=\"machine-failure-details.csv\"');
  res.send(toCsv(failures));
});

app.get('/machines/:id', ensureAuthenticated, (req, res) => {
  const machine = get('SELECT * FROM machines WHERE id = ?', [req.params.id]);

  if (!machine) {
    return res.status(404).send('Machine not found');
  }

  const components = all(
    'SELECT name FROM machine_components WHERE machine_id = ? ORDER BY name',
    [req.params.id]
  );
  const materialUsage = all(
    `SELECT materials.name, SUM(material_usage.quantity_used) AS total_used
     FROM material_usage
     JOIN materials ON materials.id = material_usage.material_id
     WHERE material_usage.machine_id = ?
     GROUP BY materials.name
     ORDER BY total_used DESC`,
    [req.params.id]
  );
  const workOrders = all(
    `SELECT work_orders.*, users.name AS technician_name
     FROM work_orders
     LEFT JOIN users ON users.id = work_orders.assigned_to
     WHERE machine_id = ?
     ORDER BY datetime(failure_time) DESC`,
    [req.params.id]
  );

  res.render('machine-details', {
    title: machine.name,
    machine,
    components,
    materialUsage,
    workOrders
  });
});

app.get('/resources', ensureAuthenticated, (req, res) => {
  const materials = all(
    `SELECT materials.*,
            COALESCE(used.total_used, 0) AS total_used
     FROM materials
     LEFT JOIN (
       SELECT material_id, SUM(quantity_used) AS total_used
       FROM material_usage
       GROUP BY material_id
     ) used ON used.material_id = materials.id
     ORDER BY materials.name`
  );

  const usageByMachine = all(
    `SELECT machines.name AS machine_name, materials.name AS material_name,
            SUM(material_usage.quantity_used) AS quantity_used
     FROM material_usage
     JOIN machines ON machines.id = material_usage.machine_id
     JOIN materials ON materials.id = material_usage.material_id
     GROUP BY machines.name, materials.name
     ORDER BY machines.name, materials.name`
  );

  res.render('resources', {
    title: 'Resources',
    materials,
    usageByMachine,
    editingMaterialId: Number(req.query.edit || 0)
  });
});

app.get('/resources/export', allowRoles('Admin', 'Manager'), (req, res) => {
  const materials = all(
    `SELECT materials.name,
            materials.quantity,
            materials.threshold,
            COALESCE(used.total_used, 0) AS total_used,
            CASE
              WHEN materials.quantity <= materials.threshold THEN 'Low Stock'
              ELSE 'Healthy'
            END AS stock_status
     FROM materials
     LEFT JOIN (
       SELECT material_id, SUM(quantity_used) AS total_used
       FROM material_usage
       GROUP BY material_id
     ) used ON used.material_id = materials.id
     ORDER BY materials.name`
  );

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=\"resources-report.csv\"');
  res.send(toCsv(materials));
});

app.post('/resources', allowRoles('Admin', 'Manager'), (req, res) => {
  const { name, quantity, threshold } = req.body;
  const parsedQuantity = Number(quantity);
  const parsedThreshold = Number(threshold);

  if (
    !isNonEmptyString(name) ||
    Number.isNaN(parsedQuantity) ||
    Number.isNaN(parsedThreshold) ||
    parsedQuantity < 0 ||
    parsedThreshold < 0
  ) {
    return res.status(400).send('Invalid material data');
  }

  run(
    'INSERT INTO materials (name, quantity, threshold) VALUES (?, ?, ?)',
    [name.trim(), parsedQuantity, parsedThreshold]
  );
  res.redirect('/resources');
});

app.post('/resources/:id/update', allowRoles('Admin', 'Manager'), (req, res) => {
  const materialId = Number(req.params.id);
  const { name, quantity, threshold } = req.body;
  const parsedQuantity = Number(quantity);
  const parsedThreshold = Number(threshold);

  if (
    !Number.isInteger(materialId) ||
    !isNonEmptyString(name) ||
    Number.isNaN(parsedQuantity) ||
    Number.isNaN(parsedThreshold) ||
    parsedQuantity < 0 ||
    parsedThreshold < 0
  ) {
    return res.status(400).send('Invalid material data');
  }

  const existingMaterial = get('SELECT id FROM materials WHERE id = ?', [materialId]);
  if (!existingMaterial) {
    return res.status(404).send('Material not found');
  }

  run(
    'UPDATE materials SET name = ?, quantity = ?, threshold = ? WHERE id = ?',
    [name.trim(), parsedQuantity, parsedThreshold, materialId]
  );

  res.redirect('/resources');
});

app.post('/resources/:id/delete', allowRoles('Admin', 'Manager'), (req, res) => {
  const materialId = Number(req.params.id);

  if (!Number.isInteger(materialId)) {
    return res.status(400).send('Invalid material id');
  }

  run('DELETE FROM material_usage WHERE material_id = ?', [materialId]);
  const result = run('DELETE FROM materials WHERE id = ?', [materialId]);

  if (!result.changes) {
    return res.status(404).send('Material not found');
  }

  res.redirect('/resources');
});

app.get('/work-orders', ensureAuthenticated, (req, res) => {
  const machines = all('SELECT id, name FROM machines ORDER BY name');
  const technicians = all(
    "SELECT id, name FROM users WHERE role = 'Technician' ORDER BY name"
  );

  let orders;
  if (req.user.role === 'Technician') {
    orders = all(
      `SELECT work_orders.*, machines.name AS machine_name, machines.loto_status AS loto_status, users.name AS technician_name
       FROM work_orders
       JOIN machines ON machines.id = work_orders.machine_id
       LEFT JOIN users ON users.id = work_orders.assigned_to
       WHERE assigned_to = ?
       ORDER BY datetime(failure_time) DESC`,
      [req.user.id]
    );
  } else {
    orders = all(
      `SELECT work_orders.*, machines.name AS machine_name, machines.loto_status AS loto_status, users.name AS technician_name
       FROM work_orders
       JOIN machines ON machines.id = work_orders.machine_id
       LEFT JOIN users ON users.id = work_orders.assigned_to
       ORDER BY datetime(failure_time) DESC`
    );
  }

  res.render('work-orders', {
    title: 'Work Orders',
    machines,
    orders,
    technicians
  });
});

app.post('/work-orders', allowRoles('Admin', 'Manager'), (req, res) => {
  const {
    machine_id,
    assigned_to,
    title,
    description,
    status,
    failure_time,
    start_time,
    end_time
  } = req.body;

  const machineId = Number(machine_id);
  const assignedTo = assigned_to ? Number(assigned_to) : null;

  if (
    !isNonEmptyString(title) ||
    !Number.isInteger(machineId)
  ) {
    return res.status(400).send('Invalid work order data');
  }

  if (assignedTo !== null && !Number.isInteger(assignedTo)) {
    return res.status(400).send('Invalid technician assignment');
  }

  if (!['Pending', 'In Progress', 'Completed'].includes(status)) {
    return res.status(400).send('Invalid work order status');
  }

  run(
    `INSERT INTO work_orders
     (machine_id, assigned_to, title, description, status, failure_time, start_time, end_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      machineId,
      assignedTo,
      title.trim(),
      isNonEmptyString(description) ? description.trim() : null,
      status,
      failure_time || null,
      start_time || null,
      end_time || null
    ]
  );

  if (status === 'Completed') {
    run('UPDATE machines SET status = ? WHERE id = ?', ['Active', machineId]);
  } else if (status === 'Pending' || status === 'In Progress') {
    run('UPDATE machines SET status = ? WHERE id = ?', ['Breakdown', machineId]);
  }

  if (assignedTo !== null) {
    createNotification(assignedTo, `You have been assigned a new work order: ${title.trim()}`);
  }

  res.redirect('/work-orders');
});

app.post('/work-orders/:id/status', ensureAuthenticated, (req, res) => {
  const order = get('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
  if (!order) {
    return res.status(404).send('Work order not found');
  }

  const isOwner = req.user.role === 'Technician' && order.assigned_to === req.user.id;
  const isManagerial = ['Admin', 'Manager'].includes(req.user.role);
  if (!isOwner && !isManagerial) {
    return res.status(403).render('forbidden', { title: 'Access Denied' });
  }

  const status = req.body.status;
  const failureCategory = req.body.failure_category || null;

  if (!['Pending', 'In Progress', 'Completed'].includes(status)) {
    return res.status(400).send('Invalid work order status');
  }

  const machine = get('SELECT loto_status, loto_user_id FROM machines WHERE id = ?', [order.machine_id]);
  if (machine && machine.loto_status === 'Locked' && machine.loto_user_id !== req.user.id && req.user.role !== 'Admin') {
    return res.status(403).send('Machine is locked (LOTO). Only the user who locked it or an Admin can change its status.');
  }

  if (status === 'Completed' && !failureCategory && order.failure_time) {
    return res.status(400).send('Failure category is required to complete a breakdown work order');
  }

  let startTime = order.start_time;
  let endTime = order.end_time;

  if (status === 'In Progress' && !startTime) {
    startTime = new Date().toISOString().slice(0, 16);
  }

  if (status === 'Completed' && !endTime) {
    endTime = new Date().toISOString().slice(0, 16);
  }

  run(
    'UPDATE work_orders SET status = ?, start_time = ?, end_time = ?, failure_category = ? WHERE id = ?',
    [status, startTime, endTime, failureCategory, Number(req.params.id)]
  );

  run('UPDATE machines SET status = ? WHERE id = ?', [
    status === 'Completed' ? 'Active' : 'Breakdown',
    order.machine_id
  ]);

  if (status === 'Completed') {
     const managers = all("SELECT id FROM users WHERE role IN ('Admin', 'Manager')");
     managers.forEach(m => {
       createNotification(m.id, `Work Order Completed: ${order.title}`);
     });
  }

  res.redirect('/work-orders');
});

app.get('/predict/:machine_id', ensureAuthenticated, async (req, res) => {
  const machineId = Number(req.params.machine_id);

  if (!Number.isInteger(machineId)) {
    return res.status(400).json({ error: 'Invalid machine id' });
  }

  const logs = all(
    'SELECT repair_time, failure_time, created_at FROM maintenance_logs WHERE machine_id = ? ORDER BY created_at ASC',
    [machineId]
  );

  const prediction = await predictMachine(machineId.toString(), logs);
  res.json(prediction);
});

app.get('/safety', ensureAuthenticated, (req, res) => {
  const reports = all('SELECT safety_reports.*, machines.name as machine_name FROM safety_reports LEFT JOIN machines ON safety_reports.machine_id = machines.id ORDER BY date DESC, id DESC');
  const machines = all('SELECT id, name FROM machines ORDER BY name');
  res.render('safety', {
    title: 'Safety',
    reports,
    machines
  });
});

app.post('/safety', ensureAuthenticated, (req, res) => {
  const { employee_name, description, risk_level, date, machine_id } = req.body;
  if (!isNonEmptyString(employee_name) || !isNonEmptyString(description) || !isNonEmptyString(risk_level) || !isNonEmptyString(date)) {
    return res.status(400).send('Invalid safety report data');
  }

  const mId = machine_id ? Number(machine_id) : null;

  run(
    `INSERT INTO safety_reports (employee_name, description, risk_level, date, machine_id)
     VALUES (?, ?, ?, ?, ?)`,
    [employee_name.trim(), description.trim(), risk_level, date, mId]
  );

  if (risk_level === 'Major') {
    const managers = all("SELECT id FROM users WHERE role IN ('Admin', 'Manager')");
    managers.forEach(m => {
      createNotification(m.id, `EMERGENCY: Major Safety Incident Reported by ${employee_name.trim()}!`);
    });
  }

  res.redirect('/safety');
});

app.post('/notifications/:id/read', ensureAuthenticated, (req, res) => {
  markAsRead(Number(req.params.id), req.user.id);
  res.redirect('back');
});

app.listen(PORT, () => {
  console.log(`JK Fenner CMMS running on http://localhost:${PORT}`);
});
