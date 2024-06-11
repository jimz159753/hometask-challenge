const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model')
const {getProfile} = require('./middleware/getProfile');
const {Op} = require('sequelize');

const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

app.get('/contracts/:id',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const contract = await Contract.findOne({where: {id}})
    if(!contract) return res.status(404).end()
    res.json(contract)
})

app.get('/contracts',getProfile ,async (req, res) =>{
    const {Contract} = req.app.get('models')
    const contracts = await Contract.findAll()
    if(!contracts) return res.status(404).end()
    res.json(contracts)
})

app.get('/jobs/unpaid',getProfile ,async (req, res) =>{
    const {Contract, Job} = req.app.get('models')
    const contracts = await Contract.findAll({ 
        where: {
            status: {
                [Op.not]: 'terminated'
            }
        },
        include: [
            {
                model: Job,
                where: {
                    paid: null
                }
            }
        ]
    })
    if(!contracts) return res.status(404).end()
    const jobs = contracts.flatMap(contract => contract.Jobs)
    res.json(jobs)
})

app.post('/jobs/:job_id/pay',getProfile ,async (req, res) =>{
    const jobId = req.params.job_id
    const {Profile, Job, Contract} = req.app.get('models')
    const client = await Profile.findOne({
        where: {id: req.get('profile_id')}, 
        raw: true, 
        nest: true
    })
    const job = await Job.findOne({ 
        where: { id: jobId}, 
        raw: true, 
        nest: true
    })

    if(client.balance >= job.price && !job.paid) {
        // DECREMENT THE BALANCE OF THE CLIENT
        await Profile.decrement('balance', { 
            by: job.price, 
            where: { id: req.get('profile_id')}
        })
        // LOOK FOR A CONTRACT BY ID
        const contract = await Contract.findOne({ 
            where: { id: job.ContractId}, 
            raw: true, 
            nest: true
        })
        // INCREMENT THE BALANCE OF THE CONTRACTOR
        await Profile.increment('balance', {
            by: job.price,
            where: { id: contract.ContractorId }
        })
        // UPDATE THE STATUS OF THE JOB TO PAID
        await Job.update({ paid: true, paymentDate: new Date() }, { 
            where: { id: jobId}
        })
    }

    const jobUpdated = await Job.findOne({ 
        where: { id: jobId}
    })
    if(!jobUpdated) return res.status(404).end()
    res.json(jobUpdated)
})

app.post('/balances/deposit/:userId',getProfile ,async (req, res) =>{
    const userId = req.params.userId
    const amount = req.body.amount
    const jobId = req.body.jobId
    const {Profile, Job} = req.app.get('models')

    const client = await Profile.findOne({
        where: {id: req.get('profile_id')}, 
        raw: true, 
        nest: true
    })

    const job = await Job.findOne({
        where: { id: jobId },
        raw: true, 
        nest: true
    })
    // JUST 20% OF THE JOB PRICE IS ALLOWED
    const amountAllowed = (job.price * 20) / 100

    if(amount <= amountAllowed && amount <= client.balance) {
        // DECREMENT THE BALANCE OF THE CLIENT
        await Profile.decrement('balance', { 
            by: amount, 
            where: { id: req.get('profile_id')}
        })
        // INCREMENT THE BALANCE OF THE CONTRACTOR
        await Profile.increment('balance', {
            by: amount,
            where: { id: userId }
        })

        res.json('Deposit done!')
    } else {
        res.json('The amount is not allowed or you do not have enough balance.')
    }
})

app.get('/admin/best-profession',getProfile ,async (req, res) =>{
    const {startDate, endDate} = req.query
    const {Profile, Contract, Job} = req.app.get('models')
    
    const contractors = await Profile.findAll({
        raw: true, 
        nest: true,
        include: [
            {
                model: Contract,
                as: 'Contractor',
                where: {
                    status: 'terminated'
                },
                include: {
                    model: Job,
                    where: {
                        paymentDate: {
                            [Op.between]: [startDate, endDate]
                        }
                    }
                }
            },
        ]
    }) 

    const professions = contractors.reduce((acc, cur) => {
        if(acc[cur.profession]) {
            acc[cur.profession] += cur.Contractor.Jobs.price 
        } else {
            acc[cur.profession] = cur.Contractor.Jobs.price
        }
        return acc
    }, {})

    
    if(!professions) return res.status(404).end()
    const bestProfession = Object.entries(professions).reduce((acc, cur) => {
        if(acc[1] < cur[1]) {
            acc = cur
        }
        return cur
    })
    res.json(bestProfession[0])
})

app.get('/admin/best-clients',getProfile ,async (req, res) =>{
    const {startDate, endDate} = req.query
    const {Profile, Contract, Job} = req.app.get('models')
    
    const profiles = await Profile.findAll({
        nest: true,
        include: [
            {
                model: Contract,
                as: 'Client',
                where: {
                    status: 'terminated',
                },
                include: {
                    model: Job,
                    where: {
                        paymentDate: {
                            [Op.between]: [startDate, endDate]
                        }
                    }
                }
            },
        ]
    }) 

    const clients = profiles.map(el => {
        const sumPrice = el.toJSON().Client[0].Jobs.reduce((acc, cur) => {
            acc += cur.price
            return acc
        }, 0)
        const newProfile = {}
        newProfile['paid'] = sumPrice 
        newProfile['fullName'] = `${el.firstName} ${el.lastName}` 
        newProfile['id'] = el.id 
        return newProfile 
    })

    const bestClients = clients.sort((a, b) => b.paid - a.paid).slice(0, 2)

    res.json(bestClients)
})

module.exports = app;
