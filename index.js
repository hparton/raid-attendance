require('dotenv').config()

const { GraphQLClient, gql } = require('graphql-request')
const { format } = require('date-fns')
const fetch = require('node-fetch')
const createCsvWriter = require('csv-writer').createObjectCsvWriter

const alts = [
  ['Ginshi', 'Jinshi'],
  ['Shaní', 'Manida'],
  ['Kagejinn', 'Ezkage', 'Kagenoroi'],
  ['Liquidpower', 'Eludien', 'Dahwa'],
  ['Dumbclass', 'Bigfast'],
  ['Flórpdru', 'Flórprogue', 'Flórpmonk'],
  ['Suni', 'Venkalth'],
  ['Miffzy', 'Miffysaurus'],
  ['Controlling', 'Conflagrated', 'Concentrated'],
  ['Hãze', 'Hazékazam'],
  ['Dorathy', 'Friedeggs', 'Restoration', 'Tn'],
  ['Yanembi', 'Yanembathy'],
  ['Chaoriel', 'Chaoren'],
  ['Svusj', 'Svûsj', 'Khalyz'],
  ['Dauntilus', 'Sharissa'],
  ['Otje', 'Otjé'],
]

const exclude = ['Zenrawr', 'Zensham', 'Menotröll', 'Niake']

const endpoint = 'https://www.warcraftlogs.com/api/v2/client'

const pipe = (...fns) => x => fns.reduce((v, f) => f(v), x)

const bootstrap = async () => {
  console.log('Getting auth token...')
  const authToken = await fetch('https://www.warcraftlogs.com/oauth/token', {
    body: 'grant_type=client_credentials',
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.WARCRAFT_LOGS_CLIENT}:${process.env.WARCRAFT_LOGS_SECRET}`
      ).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  })
    .then(res => res.json()) // expecting a json response
    .then(json => `${json.token_type} ${json.access_token}`)

  const graphQLClient = new GraphQLClient(endpoint, {
    headers: {
      authorization: authToken,
    },
  })

  console.log('OAuth token obtained.')

  console.log('Getting attendance report...')

  const data = await getAttendance(graphQLClient)

  console.log('Got all reports for Castle Nathria.')

  console.log('Processing data...')
  const processedData = pipe(sortByDate, formatDates, mergeDates, excludePlayers, replaceAlts, deDupePlayers)(data)
  const everyone = getAllPlayers(processedData)

  console.log('Writing to CSV...')

  // check each date and output "" or "x", if before first raid ouput "n/a"
  const csvFormattedPlayers = everyone
    .map(playerName => {
      const player = { name: playerName }

      processedData.map(report => {
        const attended = 'x'
        const beforeFirstRaid = 'n/a'

        if (report.players.findIndex(plyr => plyr.name === playerName) !== -1) {
          player[report.date] = attended
        } else {
          // if we don't find an attended, then it's n/a
          // once we find 1 attended then it's false

          if (!Object.keys(player).filter(key => key !== 'name' && player[key] === attended).length) {
            player[report.date] = beforeFirstRaid
          } else {
            player[report.date] = null
          }
        }
      })

      return player
    })
    .sort(
      (a, b) =>
        Object.keys(b).filter(key => key !== 'name' && b[key] === 'x').length -
        Object.keys(a).filter(key => key !== 'name' && a[key] === 'x').length
    )

  const csvWriter = createCsvWriter({
    path: 'out.csv',
    header: Object.keys(csvFormattedPlayers[0]).map(key => ({ id: key, title: key })),
    alwaysQuote: true,
  })

  await csvWriter.writeRecords(csvFormattedPlayers)

  console.log('The CSV file was written successfully')
}

const getAttendance = async (client, page = 1, attendance = []) => {
  const query = gql`
    query getAttendance($page: Int!) {
      guildData {
        guild(id: 492939) {
          attendance(zoneID: 26, page: $page) {
            current_page
            has_more_pages
            data {
              startTime
              players {
                name
                presence
              }
            }
          }
        }
      }
    }
  `

  const gqlRequest = await client.request(query, { page })
  const report = gqlRequest.guildData.guild.attendance

  const combinedData = [...attendance, ...report.data]

  if (report.has_more_pages) {
    console.log(`Report has more pages, grabbing page ${page + 1}...`)
    return await getAttendance(client, page + 1, combinedData)
  } else {
    return combinedData
  }
}

const sortByDate = data => data.slice().sort((a, b) => a.startTime - b.startTime)

const formatDates = data =>
  data.map(item => {
    item.date = format(item.startTime, 'dd/MM/yyyy')
    return item
  })

const mergeDates = data =>
  data.reduce((arr, item) => {
    let existingDateIndex = arr.findIndex(existing => existing.date === item.date)
    if (existingDateIndex !== -1) {
      arr[existingDateIndex].players = [...arr[existingDateIndex].players, ...item.players]
      return arr
    } else {
      return [...arr, item]
    }
  }, [])

const replaceAlts = data =>
  data.map(item => {
    item.players = item.players.map(player => {
      const aliases = alts.find(names => names.includes(player.name))
      if (!aliases) {
        return player
      }

      player.name = aliases[0]
      return player
    })
    return item
  })

const deDupePlayers = data =>
  data.map(item => {
    const checked = []
    item.players = item.players.filter(player => {
      if (checked.includes(player.name)) {
        return false
      }

      checked.push(player.name)
      return true
    })

    return item
  })

const getAllPlayers = data =>
  data.reduce((arr, item) => {
    item.players.forEach(player => {
      if (!arr.includes(player.name)) {
        arr.push(player.name)
      }
    })

    return arr
  }, [])

const excludePlayers = data =>
  data.map(item => {
    item.players = item.players.filter(player => {
      return !exclude.includes(player.name)
    })

    return item
  })

bootstrap()
